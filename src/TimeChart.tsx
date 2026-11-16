import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Brush, ReferenceLine } from 'recharts';
import type { RecordData } from './api';
import { Empty, metricNames } from './components';
const colors = ['#7364d9', '#3da19b', '#e4b960', '#dd7f91', '#6098d5', '#a2b575', '#be8bd7', '#f2a579', '#76948a', '#8c8cdb'];
export default function TimeChart({ data, keys, labels = {}, percent = false, height = 310 }: {
    data: RecordData[];
    keys: string[];
    labels?: Record<string, string>;
    percent?: boolean;
    height?: number;
}) { if (!data?.length)
    return <Empty title="尚无可绘制的序列"/>; return <div className="time-chart" style={{ height }}><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 4 }}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e9edf4"/><XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8892a3' }} tickLine={false} axisLine={false} minTickGap={65} tickFormatter={value => String(value).slice(0, 10)}/><YAxis tick={{ fontSize: 11, fill: '#8892a3' }} tickLine={false} axisLine={false} width={58} tickFormatter={value => percent ? (value * 100).toFixed(0) + '%' : Number(value).toFixed(2)} domain={['auto', 'auto']}/><Tooltip contentStyle={{ border: '1px solid #eceaf6', borderRadius: 10, fontSize: 12, boxShadow: '0 8px 30px #18213a10' }} formatter={(value: any, name: any) => [typeof value === 'number' ? (percent ? (value * 100).toFixed(3) + '%' : value.toFixed(4)) : value, name]}/><Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="circle" iconSize={7}/><ReferenceLine y={0} stroke="#e4e7ee"/>{keys.map((key, i) => <Line key={key} dataKey={key} name={labels[key] || metricNames[key] || key} stroke={colors[i % colors.length]} strokeWidth={1.8} dot={false} connectNulls={false} isAnimationActive={false}/>)}{data.length > 40 && <Brush dataKey="date" height={20} stroke="#d9d4ee" fill="#faf9ff" travellerWidth={5} tickFormatter={value => String(value).slice(0, 10)}/>}</LineChart></ResponsiveContainer></div>; }
