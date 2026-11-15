import { useCallback, useEffect, useRef, useState } from 'react';
export type RecordData = Record<string, any>;
export interface Factor extends RecordData {
    id: string;
    name: string;
    category: string;
    description: string;
    source_kind: 'native_ast' | 'legacy';
    version: number;
    code: string;
    dependencies: string[];
    status: string;
}
export interface Run extends RecordData {
    id: string;
    name: string;
    kind: 'factor' | 'strategy';
    status: string;
    progress: number;
    message: string;
    created_at: string;
    config: RecordData;
    result?: RecordData;
}
export class ApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
}
export const isPublicMode = (import.meta as ImportMeta & { env?: { VITE_PUBLIC_MODE?: string } }).env?.VITE_PUBLIC_MODE === 'true';
export async function api<T = RecordData>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    if (isPublicMode) {
        const { publicRequest } = await import('./publicApi');
        try { return await publicRequest(path, method, body, signal) as T; }
        catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; throw new ApiError(error instanceof Error ? error.message : String(error), typeof (error as any)?.status === 'number' ? (error as any).status : 422); }
    }
    const response = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
    const content = await response.text();
    let value: any;
    try {
        value = content ? JSON.parse(content) : null;
    }
    catch {
        throw new ApiError('服务器返回了无法读取的响应，请确认后台服务正常。', response.status);
    }
    if (!response.ok) {
        if (response.status === 401 && path !== '/login')
            window.dispatchEvent(new Event('quant-session-expired'));
        const detail = value?.detail ?? value?.error ?? value?.message;
        const message = response.status === 409 ? '版本已被更新。请刷新读取最新版本，再合并你的修改。' : typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : `请求失败（${response.status}）`;
        throw new ApiError(message, response.status);
    }
    return value as T;
}
export function useApi<T = RecordData>(path: string | null, poll = 0) {
    const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
    const refresh = useCallback(() => setRevision(n => n + 1), []);
    const requestRef = useRef(0);
    useEffect(() => {
        setData(null);
        setError('');
        setLoading(true);
    }, [path]);
    useEffect(() => {
        if (!path) {
            setLoading(false);
            return;
        }
        const controller = new AbortController();
        let alive = true;
        const read = async () => { const seq = ++requestRef.current; try {
            const result = await api<T>(path, 'GET', undefined, controller.signal);
            if (alive && seq === requestRef.current) {
                setData(result);
                setError('');
            }
        }
        catch (e) {
            if (alive && !(e instanceof DOMException && e.name === 'AbortError'))
                setError(errorMessage(e));
        }
        finally {
            if (alive)
                setLoading(false);
        } };
        void read();
        const timer = poll ? window.setInterval(read, poll) : undefined;
        return () => { alive = false; controller.abort(); if (timer)
            window.clearInterval(timer); };
    }, [path, poll, revision]);
    return { data, error, loading, refresh };
}
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
export function go(path: string) { window.location.hash = path; }
export function useRoute() { const [route, setRoute] = useState(window.location.hash.slice(1) || '/'); useEffect(() => { const changed = () => setRoute(window.location.hash.slice(1) || '/'); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []); return route; }
export function downloadFile(name: string, content: string, type = 'text/plain;charset=utf-8') { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export async function exportRun(identifier: string) { const payload = await api('/runs/' + encodeURIComponent(identifier) + '/export'); downloadFile(identifier + '.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8'); }
export async function exportSnapshot() { if (!isPublicMode) throw new ApiError('完整服务端研究快照由后台备份命令导出；可在任务详情导出单项结果。', 422); const payload = await api('/snapshot'); downloadFile('singularityx-public-snapshot.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8'); }
