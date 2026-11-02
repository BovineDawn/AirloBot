import React from 'react';
import { freshHardware, hardwareBudget } from '../shared/model-compatibility.mjs';
import { useAssessmentClock } from './ModelCompatibility.jsx';
import { memorySize } from './HardwareSettings.jsx';
export default function DeviceGuidance({ state, openHardware, compact = false }) {
  const now = useAssessmentClock(), ready = freshHardware(state.hardwareProfile, state.settings, now);
  const budget = ready && hardwareBudget(state.hardwareProfile, state.settings);
  const known = budget && (budget.gpu || state.settings.acceleration === 'cpu' || state.hardwareProfile.gpuStatus === 'none');
  return <div className={'device-guidance'+(compact ? ' compact' : '')}><div><strong>{ready ? 'Choosing for this computer' : state.settings.hardwareRecommendations ? 'Refresh your device snapshot' : 'Get model guidance for your computer'}</strong>{!compact && <p>{known ? budget.fileTarget > 0 ? `Start with files around ${memorySize(budget.fileTarget)} or smaller for ${budget.gpu ? 'GPU' : 'CPU'} use, then compare memory fit. This is a rough starting range that reserves room for context, not a loading guarantee.` : 'Available memory is low. Close other apps or unload a model, then refresh the scan before choosing a download.' : ready ? 'GPU memory could not be determined. You can still compare in CPU mode or choose manually.' : state.settings.hardwareRecommendations ? 'Choose Scan now or Refresh scan. Snapshots clear on exit and comparisons expire after 15 minutes.' : 'Enable the optional local hardware check, then scan. AirloBot can explain memory limits and compare models without uploading device data.'}</p>}</div><button className="button secondary" onClick={openHardware}>{ready ? 'Device details' : state.settings.hardwareRecommendations ? 'Open device check' : 'Set up recommendations'}</button></div>;
}
