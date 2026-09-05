import { prisma } from '@/lib/prisma';
import {
  withAuth, ok, created, fail, MESSAGES,
  requireManage, requireVisible, readJson, str, requireQuery,
} from '@/lib/core/http';

type Params = { id: string };

function pickChannelFields(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  const name = str(body, 'name', { max: 100 }); if (name !== undefined) data.name = name.trim();
  if (typeof body.importUrl === 'string' || body.importUrl === null) data.importUrl = body.importUrl;
  if (typeof body.exportUrl === 'string' || body.exportUrl === null) data.exportUrl = body.exportUrl;
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
  return data;
}

export const GET = withAuth<Params>('properties/channels', async (_req, { auth, params }) => {
  await requireVisible(auth, params.id);
  return ok(await prisma.propertyChannel.findMany({ where: { propertyId: params.id } }));
});

export const POST = withAuth<Params>('properties/channels', async (req, { auth, params }) => {
  requireManage(auth, params.id);
  const data = pickChannelFields(await readJson(req));
  if (typeof data.name !== 'string' || !data.name) throw fail(400, 'name은 필수입니다.');
  return created(await prisma.propertyChannel.create({
    data: {
      propertyId: params.id,
      name: data.name,
      importUrl: (data.importUrl as string | null | undefined) ?? null,
      exportUrl: (data.exportUrl as string | null | undefined) ?? null,
      isActive: (data.isActive as boolean | undefined) ?? true,
    },
  }));
});

export const PUT = withAuth('properties/channels', async (req, { auth }) => {
  const body = await readJson(req);
  const channelId = str(body, 'channelId', { required: true })!;
  const channel = await prisma.propertyChannel.findUnique({ where: { id: channelId }, select: { propertyId: true } });
  if (!channel) throw fail(404, MESSAGES.notFound);
  requireManage(auth, channel.propertyId);

  const data = pickChannelFields(body);
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);
  return ok(await prisma.propertyChannel.update({ where: { id: channelId }, data }));
});

export const DELETE = withAuth('properties/channels', async (req, { auth }) => {
  const channelId = requireQuery(req, 'channelId');
  const channel = await prisma.propertyChannel.findUnique({ where: { id: channelId }, select: { propertyId: true } });
  if (!channel) throw fail(404, MESSAGES.notFound);
  requireManage(auth, channel.propertyId);

  await prisma.propertyChannel.delete({ where: { id: channelId } });
  return ok({ success: true });
});
