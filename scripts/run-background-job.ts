import { backgroundJobName, runBackgroundJob, type JobReply } from '../lib/jobs/background-runner';
import { gcpBackgroundJobsEnabled } from '../lib/jobs/background-controls';

async function main() {
  const name = backgroundJobName(process.argv[2]);
  if (process.argv[3] !== undefined && process.argv[3] !== '--check') throw new Error('Unknown background job option.');
  if (!gcpBackgroundJobsEnabled()) {
    console.log(JSON.stringify({ job: name, status: 'disabled' }));
    return;
  }
  if (!process.env.JWT_SECRET || !process.env.CRON_SECRET) throw new Error('JWT_SECRET and CRON_SECRET are required for background jobs.');
  const { prisma } = await import('../lib/prisma');
  try {
    if (process.argv[3] === '--check') {
      if (name === 'beds24-sync') await import('../lib/jobs/beds24-sync');
      if (name === 'camera-inbox') await import('../lib/jobs/camera-inbox');
      if (name === 'beds24-messages') {
        await import('../app/api/beds24/messages/route');
        await import('../app/api/inquiry-automation/process/route');
      }
      if (name === 'payments') await import('../app/api/cron/payments/route');
      console.log(JSON.stringify({ job: name, status: 'ready' }));
      return;
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
    const result = await runBackgroundJob(name, {
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
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ component: 'legacy-background-job', event: 'failed', name: error instanceof Error ? error.name : 'Error' }));
  process.exitCode = 1;
});
