import { NextResponse } from 'next/server';
import { signQzPayload } from '../../../../src/server/qzSigning.js';

export const runtime = 'nodejs';

export async function POST(request) {
  const payload = await request.text();

  if (!payload) {
    return new NextResponse('Missing QZ payload to sign.', { status: 400 });
  }

  try {
    const signature = await signQzPayload(payload);
    return new NextResponse(signature, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return new NextResponse(error.message || 'Could not sign QZ payload.', { status: 500 });
  }
}
