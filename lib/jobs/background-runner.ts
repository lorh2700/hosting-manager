export const backgroundJobNames = ['beds24-sync', 'beds24-messages', 'camera-inbox', 'payments'] as const;
export type BackgroundJobName = typeof backgroundJobNames[number];
export type JobReply = { status: number; data: Record<string, unknown> };
export type BackgroundDependencies = {
  syncReservations: () => Promise<unknown>;
  pollCameras: () => Promise<unknown>;
  ingestMessages: () => Promise<JobReply>;
  processInquiries: (mode: 'seed' | 'jobs' | 'notifications') => Promise<JobReply>;
  reconcilePayments: () => Promise<JobReply>;
  paymentsConfigured: boolean;
  now?: () => number;
};

export function backgroundJobName(value: string | undefined): BackgroundJobName {
  if (!backgroundJobNames.includes(value as BackgroundJobName)) throw new Error('Unknown background job.');
  return value as BackgroundJobName;
}

const success = (reply: JobReply) => reply.status >= 200 && reply.status < 300;

export async function runBackgroundJob(name: BackgroundJobName, dependencies: BackgroundDependencies) {
  if (name === 'beds24-sync') {
    await dependencies.syncReservations();
    return { job: name, status: 'completed' };
  }
  if (name === 'camera-inbox') {
    await dependencies.pollCameras();
    return { job: name, status: 'completed' };
  }
  if (name === 'payments') {
    if (!dependencies.paymentsConfigured) return { job: name, status: 'not_configured' };
    let batches = 0;
    for (; batches < 5; batches++) {
      const reply = await dependencies.reconcilePayments();
      if (!success(reply)) return { job: name, status: 'retry_pending', batches };
      if (!Array.isArray(reply.data.results)) throw new Error('Invalid payment reconciliation response.');
      if (!reply.data.results.length) break;
    }
    return { job: name, status: 'completed', batches };
  }
  const now = dependencies.now ?? Date.now;
  const started = now();
  const ingestion = await dependencies.ingestMessages();
  const work = async (mode: 'seed' | 'jobs' | 'notifications') => {
    const reply = await dependencies.processInquiries(mode);
    if (!success(reply)) throw new Error(`Inquiry ${mode} failed with HTTP ${reply.status}.`);
    if (mode !== 'seed' && typeof reply.data.worked !== 'boolean') throw new Error('Invalid inquiry worker response.');
    return reply.data;
  };
  await work('seed');
  let iterations = 0;
  for (; iterations < 80 && now() - started < 10 * 60_000; iterations++) {
    const job = await work('jobs');
    const notification = await work('notifications');
    if (!job.worked && !notification.worked) break;
  }
  if (!success(ingestion)) throw new Error(`Message ingestion failed with HTTP ${ingestion.status}; queued inquiries were still processed.`);
  return { job: name, status: 'completed', iterations };
}
