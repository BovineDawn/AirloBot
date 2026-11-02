import React from 'react';
import { Download, Heart, CalendarDays, HardDrive } from 'lucide-react';
import { formatBytes } from './ui.jsx';
import { fileSizeRange } from '../shared/model-catalog.mjs';
export default function ModelMetrics({ model, files, loading = false }) {
  const range = fileSizeRange(files);
  const date = model.lastModified && Number.isFinite(Date.parse(model.lastModified)) ? new Date(model.lastModified) : null;
  return <div className="model-metrics">
    <span title="Repository downloads reported by Hugging Face over the last 30 days"><Download size={13}/>{Number.isFinite(model.downloads) ? model.downloads.toLocaleString() : 'Unknown'} downloads / month</span>
    <span title="Community likes on Hugging Face, not a quality rating"><Heart size={13}/>{Number.isFinite(model.likes) ? model.likes.toLocaleString() : 'Unknown'} likes</span>
    <span title="Latest repository update; individual model files may be older"><CalendarDays size={13}/>{date ? <time dateTime={date.toISOString()}>Updated {date.toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric', timeZone:'UTC'})}</time> : 'Update date unavailable'}</span>
    {files !== undefined || loading ? <span title="Range of verified single-file GGUF download sizes; not total repository size"><HardDrive size={13}/>{loading ? 'Checking file sizes…' : range ? `${formatBytes(range.min)}${range.max !== range.min ? '–' + formatBytes(range.max) : ''} per file` : 'No supported single-file download'}</span> : null}
  </div>;
}
