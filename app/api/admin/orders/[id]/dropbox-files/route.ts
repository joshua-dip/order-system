/**
 * GET  /api/admin/orders/[id]/dropbox-files
 *   → 주문 드롭박스 폴더의 파일 목록 반환
 *
 * POST /api/admin/orders/[id]/dropbox-files
 *   Body: { paths: string[] }  (apiPath 배열)
 *   → 지정 파일을 base64 인코딩해 이메일 첨부 형식으로 반환
 *   (단일 파일 최대 20MB, 전체 50MB 제한)
 */

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import {
  listFolderFiles,
  downloadFileAsBase64,
  isDropboxConfigured,
} from '@/lib/dropbox';

export const maxDuration = 60;

const MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024;  // 20 MB
const MAX_TOTAL_BYTES       = 50 * 1024 * 1024;  // 50 MB

async function resolveOrderFolderPath(orderId: string): Promise<string | null> {
  const db = await getDb('gomijoshua');
  const root = process.env.DROPBOX_ROOT_FOLDER ?? 'gomijoshua';

  const order = await db.collection('orders').findOne(
    { _id: new ObjectId(orderId) },
    { projection: { orderNumber: 1, loginId: 1, dropboxFolderCreated: 1 } },
  );
  if (!order) return null;

  const orderNumber = (order.orderNumber as string | undefined)?.trim();
  if (!orderNumber) return null;

  const safeOrderNumber = orderNumber.replace(/[/\\:*?"<>|]/g, '').trim();
  const loginId = (order.loginId as string | undefined)?.trim();

  if (loginId) {
    const user = await db.collection('users').findOne(
      { loginId },
      { projection: { name: 1, phone: 1, dropboxFolderPath: 1 } },
    );
    const customBase = (user?.dropboxFolderPath as string | undefined)?.trim();
    if (customBase) {
      const base = customBase.replace(/\/+$/, '');
      const p = base.startsWith('/') ? base : `/${base}`;
      return `${p}/${safeOrderNumber}`;
    }
    const name = ((user?.name as string | undefined)?.trim() || loginId).replace(/[/\\:*?"<>|]/g, '').trim() || '_';
    const phone = (user?.phone as string | undefined)?.trim();
    const suffix = phone ? phone.replace(/\s/g, '').replace(/[/\\:*?"<>|]/g, '').trim() : loginId.replace(/[/\\:*?"<>|]/g, '').trim();
    return `/${root}/${name}_${suffix}/${safeOrderNumber}`;
  }

  return `/${root}/비회원/${safeOrderNumber}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 주문 ID' }, { status: 400 });
  }

  if (!isDropboxConfigured()) {
    return NextResponse.json({ error: 'Dropbox 환경 변수가 설정되지 않았습니다.' }, { status: 503 });
  }

  const folderPath = await resolveOrderFolderPath(id);
  if (!folderPath) {
    return NextResponse.json({ error: '주문을 찾을 수 없거나 주문번호가 없습니다.' }, { status: 404 });
  }

  try {
    const files = await listFolderFiles(folderPath);
    return NextResponse.json({
      ok: true,
      folderPath,
      files: files.map((f) => ({
        name: f.name,
        apiPath: f.apiPath,
        size: f.size,
        isFolder: f.isFolder,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 주문 ID' }, { status: 400 });
  }

  if (!isDropboxConfigured()) {
    return NextResponse.json({ error: 'Dropbox 환경 변수가 설정되지 않았습니다.' }, { status: 503 });
  }

  let body: { paths?: unknown; names?: unknown };
  try { body = await request.json(); } catch { body = {}; }

  const paths  = Array.isArray(body.paths)  ? (body.paths  as string[]).filter((p) => typeof p === 'string') : [];
  const names  = Array.isArray(body.names)  ? (body.names  as string[]).filter((n) => typeof n === 'string') : [];

  if (paths.length === 0) {
    return NextResponse.json({ error: 'paths 배열이 필요합니다.' }, { status: 400 });
  }

  const results: { filename: string; content: string; contentType: string; size: number }[] = [];
  let totalBytes = 0;
  const errors: string[] = [];

  for (let i = 0; i < paths.length; i++) {
    const apiPath = paths[i]!;
    const filename = names[i] ?? apiPath.split('/').pop() ?? 'file';
    try {
      const { content, contentType, size } = await downloadFileAsBase64(apiPath, filename);
      if (size > MAX_SINGLE_FILE_BYTES) {
        errors.push(`${filename}: 파일이 너무 큽니다 (${(size / 1024 / 1024).toFixed(1)} MB > 20 MB)`);
        continue;
      }
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        errors.push(`전체 용량 초과 (50 MB 제한)`);
        break;
      }
      results.push({ filename, content, contentType, size });
    } catch (e) {
      errors.push(`${filename}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok: true, files: results, errors });
}
