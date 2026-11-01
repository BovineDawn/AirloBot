import React, { useEffect, useState } from 'react';
import { modelCompatibility } from '../shared/model-compatibility.mjs';
import { memorySize } from './HardwareSettings.jsx';

export function useAssessmentClock() { const [now, setNow] = useState(Date.now()); useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []); return now; }
export function FitBadge({ result }) { return <span className={'fit-badge fit-' + result.level}>{result.label}</span>; }
export default function ModelCompatibility({ file, state }) {
  const now = useAssessmentClock(), result = modelCompatibility(file, state.hardwareProfile, state.settings, now);
  return <details className="fit-details"><summary><FitBadge result={result}/></summary><p>{result.reason}</p>{result.estimate && <p>Estimated memory: {memorySize(result.estimate.bytes)} at {result.estimate.context.toLocaleString()} context tokens, including context cache and working buffers. This is a conservative estimate, not a speed or agent-quality test.</p>}</details>;
}
