import pg from 'pg';
import { backgroundJobName, runBackgroundJob, type BackgroundJobName, type JobReply } from '../lib/jobs/background-runner';
import { gcpBackgroundJobsEnabled } from '../lib/jobs/background-controls';
import { postgresPoolOptions } from '../lib/postgres-config';

type JobLockClient = {
  connect(): Promise<unknown>;
  query(sql: string, values: number[]): Promise<{ rows: Array<{ acquired?: boolean; released?: boolean }> }>;
  end(): Promise<void>;
  on(event: 'error' | 'end', listener: () => void): unknown;
  removeListener(event: 'error' | 'end', listener: () => void): unknown;
};

const jobLockIds: Record<BackgroundJobName, number> = { 'beds24-sync': 1, 'beds24-messages': 2, 'camera-inbox': 3, payments: 4 };

export async function withBackgroundJobLock<T>(
  name: BackgroundJobName,
  work: () => Promise<T>,
  createClient: () => JobLockClient = () => {
    if (process.env.BACKEND_DB_TRANSPORT !== 'cloudsql-unix') throw new Error('Background jobs require a dedicated Cloud SQL socket connection.');
    return new pg.Client({ ...postgresPoolOptions(), query_timeout: 5000, application_name: `legacy-job-lock:${name}` });
  },
  onLockLost: () => void = () => {
    console.error(JSON.stringify({ component: 'legacy-background-job', event: 'lock-lost', job: name }));
    process.exit(1);
  },
) {
  const client = createClient();
  const key = [0x56414a42, jobLockIds[name]];
  let acquired = false;
  let closing = false;
  let lost = false;
  const connectionLost = () => {
    if (closing || lost) return;
    lost = true;
    if (acquired) onLockLost();
  };
  client.on('error', connectionLost);
  client.on('end', connectionLost);
  try {
    await client.connect();
    const result = await client.query('SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired', key);
    if (result.rows[0]?.acquired === false) return { job: name, status: 'skipped', reason: 'already_running' } as const;
    if (result.rows[0]?.acquired !== true) throw new Error('Invalid background job lock response.');
    acquired = true;
    if (lost) throw new Error('Background job lock connection was lost.');
    return await work();
  } finally {
    closing = true;
    try {
      if (acquired) {
        const result = await client.query('SELECT pg_advisory_unlock($1::int, $2::int) AS released', key);
        if (result.rows[0]?.released !== true) throw new Error('Background job lock was not released.');
      }
    } finally {
      try { await client.end(); } finally {
        client.removeListener('error', connectionLost);
        client.removeListener('end', connectionLost);
      }
    }
  }
}

export async function main() {
  const name = backgroundJobName(process.argv[2]);
  const checkOnly = process.argv[3] === '--check' || process.argv[3] === '--dry-run';
  if (process.argv[3] !== undefined && !checkOnly) throw new Error('Unknown background job option.');
  if (!gcpBackgroundJobsEnabled()) {
    console.log(JSON.stringify({ job: name, status: 'disabled' }));
    return;
  }
  if (!process.env.JWT_SECRET || !process.env.CRON_SECRET) throw new Error('JWT_SECRET and CRON_SECRET are required for background jobs.');
  const execute = async () => {
    const { prisma } = await import('../lib/prisma');
    try {
      if (checkOnly) {
        if (name === 'beds24-sync') await import('../lib/jobs/beds24-sync');
        if (name === 'camera-inbox') await import('../lib/jobs/camera-inbox');
        if (name === 'beds24-messages') {
          await import('../app/api/beds24/messages/route');
          await import('../app/api/inquiry-automation/process/route');
        }
        if (name === 'payments') await import('../app/api/cron/payments/route');
        return { job: name, status: 'ready' };
      }
      const request = (path: string, body: Record<string, unknown> = {}) => new Request(`https://background.invalid${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET! }, body: JSON.stringify(body),
      });
      const reply = async (response: Response): Promise<JobReply> => {
        const data = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid background route response.');
        return { status: response.status, data };
      };
      const context = { params: Promise.resolve({}) };
      return await runBackgroundJob(name, {
        syncReservations: async () => (await import('../lib/jobs/beds24-sync')).runBeds24Sync(),
        pollCameras: async () => (await import('../lib/jobs/camera-inbox')).runCameraInbox(),
        ingestMessages: async () => {
          const { POST } = await import('../app/api/beds24/messages/route');
          return reply(await POST(request('/api/beds24/messages'), context));
        },
        processInquiries: async mode => {
          const { POST } = await import('../app/api/inquiry-automation/process/route');
          return reply(await POST(request('/api/inquiry-automation/process', { mode }), context));
        },
        reconcilePayments: async () => {
          const { POST } = await import('../app/api/cron/payments/route');
          return reply(await POST(request('/api/cron/payments'), context));
        },
        paymentsConfigured: Boolean(process.env.TOSS_SECRET_KEY || process.env.PAYPAL_CLIENT_SECRET),
      });
    } finally {
      await prisma.$disconnect();
    }
  };
  const result = checkOnly ? await execute() : await withBackgroundJobLock(name, execute);
  console.log(JSON.stringify(result));
}

if (typeof require !== 'undefined' && require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ component: 'legacy-background-job', event: 'failed', name: error instanceof Error ? error.name : 'Error' }));
    process.exitCode = 1;
  });
}
