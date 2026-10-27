import type { APIRoute } from 'astro';
import { getAtlas } from '../lib/data.ts';

// アトラスの表示用のデータ（02 §2.7.4）
export const GET: APIRoute = () =>
  new Response(JSON.stringify(getAtlas()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
