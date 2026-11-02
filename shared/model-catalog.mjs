// Hub popularity describes a repository, never a performance or quality score.
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function catalogMetrics(model) {
  const date = typeof model.lastModified === 'string' && Number.isFinite(Date.parse(model.lastModified)) ? new Date(model.lastModified).toISOString() : null;
  return { downloads: count(model.downloads), likes: count(model.likes), lastModified: date };
}
export function fileSizeRange(files = []) {
  const sizes = files.filter(f => !f.split && !f.projector && f.sha256 && Number.isSafeInteger(f.size) && f.size > 0).map(f => f.size);
  return sizes.length ? sizes.reduce((range, size) => ({ min:Math.min(range.min,size), max:Math.max(range.max,size), count:range.count+1 }), {min:Infinity,max:0,count:0}) : null;
}
