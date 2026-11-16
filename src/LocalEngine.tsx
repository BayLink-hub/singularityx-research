import { useState, type FormEvent } from 'react';
import { Cable, Copy, ExternalLink, Unplug } from 'lucide-react';
import { api, connectLocalEngine, disconnectLocalEngine, errorMessage, isPublicBuild, localEngineOrigin, useApi } from './api';
import { ErrorBox, Field, PageHead, Panel, Tag } from './components';

export function LocalEngine({ recovery = false }: { recovery?: boolean }) {
    const [address, setAddress] = useState(localEngineOrigin || 'http://127.0.0.1:8765');
    const [token, setToken] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
    const pairing = useApi(!isPublicBuild ? '/bridge/pairing' : null);
    async function connect(event: FormEvent) {
        event.preventDefault(); setBusy(true); setError('');
        try { await connectLocalEngine(address, token); }
        catch (e) { setError(errorMessage(e) + ' 请确认本机服务正在运行，并在浏览器提示时允许此网站访问本地网络。'); }
        finally { setBusy(false); }
    }
    async function change(enabled: boolean) {
        setBusy(true); setError(''); setCopied(false);
        try { await api('/bridge/' + (enabled ? 'enable' : 'disable'), 'POST'); pairing.refresh(); }
        catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
    }
    return <div className="local-engine-page">
        <PageHead title="本地计算连接" description="通过 GitHub 网页使用这台电脑的完整数据、因子值与计算队列。"/>
        {(error || pairing.error) && <ErrorBox message={error || pairing.error}/>}
        <Panel title={localEngineOrigin ? '已选择本地引擎' : isPublicBuild ? '连接本机完整研究环境' : '管理本机配对'} actions={<Tag tone={localEngineOrigin || pairing.data?.enabled ? 'green' : 'amber'}>{localEngineOrigin ? '本地计算 · 本地保存' : isPublicBuild ? '当前为公开样本' : pairing.data?.enabled ? '已允许配对' : '未启用配对'}</Tag>}>
            <div className="padded engine-connection-body">
                {isPublicBuild ? localEngineOrigin ? <>
                    <p>当前地址：<strong>{localEngineOrigin}</strong>。因子、策略、任务与报告均由本机后台保存；原始行情和因子值留在本地，不上传 GitHub。</p>
                    {recovery && <p>本地服务暂时无法连接。启动服务后重试，或明确切回公开样本。页面不会自动混用两个环境的研究记录。</p>}
                    <div className="actions"><a className="button" href={localEngineOrigin + '/#/engine'} target="_blank" rel="noreferrer"><ExternalLink size={16}/>打开本机管理</a><button className="button" onClick={disconnectLocalEngine}><Unplug size={16}/>断开并返回公开样本</button></div>
                </> : <>
                    <p>公开网页持续在线。使用你的完整 data 和 work，需要这台电脑运行本地引擎；其他访问者不会因此获得你硬盘上的数据。</p>
                    <ol><li>在项目目录启动本地服务：<code>.venv/bin/python run.py --bridge</code></li><li>打开 <a href="http://127.0.0.1:8765/#/engine" target="_blank" rel="noreferrer">本机配对页面</a>，复制配对码。</li><li>在下方连接；浏览器如提示本地网络访问，请允许。</li></ol>
                    <form onSubmit={connect} className="engine-connect-form">
                        <Field label="本机服务地址"><input type="url" required value={address} onChange={e => setAddress(e.target.value)} placeholder="http://127.0.0.1:8765"/></Field>
                        <Field label="配对码（仅保存在当前标签页会话）"><input type="password" required autoComplete="off" value={token} onChange={e => setToken(e.target.value)} spellCheck={false}/></Field>
                        <button className="button primary" type="submit" disabled={busy}><Cable size={16}/>{busy ? '验证本机连接…' : '连接完整数据引擎'}</button>
                    </form>
                </> : <>
                    <p>本机界面已经直接连接完整研究后台。启用配对后，可在 <a href="https://baylink-hub.github.io/singularityx-research/#/engine" target="_blank" rel="noreferrer">GitHub 网站</a>使用同一后台。仅允许 <code>https://baylink-hub.github.io</code>，每次请求都验证配对码。</p>
                    {pairing.data?.enabled && <Field label="本机配对码（不要公开或发给其他人）"><div className="engine-secret"><input type="password" readOnly autoComplete="off" value={pairing.data.token || ''} aria-label="本机配对码"/><button className="button" onClick={async () => { try { await navigator.clipboard.writeText(pairing.data?.token || ''); setCopied(true); } catch { setError('浏览器未允许复制，请选中配对码手动复制。'); } }}><Copy size={15}/>{copied ? '已复制' : '复制'}</button></div></Field>}
                    <div className="actions"><button className="button primary" disabled={busy || pairing.loading} onClick={() => change(true)}>{pairing.data?.enabled ? '重置配对码' : '启用网页连接'}</button>{pairing.data?.enabled && <button className="button" disabled={busy} onClick={() => change(false)}>禁用连接</button>}</div>
                    <p className="muted">重置或禁用后，原配对码立即失效。配对码不包含在研究导出或公开发布包内。</p>
                </>}
                <p className="muted">本地模式支持历史全市场、120 个 work 因子值回放、指数与真实股票池基准。单次研究最多 3 年、8 个因子，后台顺序执行；日期或字段不足会明确报错。</p>
            </div>
        </Panel>
    </div>;
}
