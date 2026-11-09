import type { EmergencyAlert } from '../types';

const robotList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

// One sentence per kind, so a fleet e-stop reads as one alert rather than one per robot.
export const describeEmergencyAlerts = (alerts: EmergencyAlert[]) =>
  (['hardware', 'software'] as const)
    .map(kind => alerts.filter(alert => alert.kind === kind).map(alert => alert.robotName))
    .map((names, index) =>
      names.length === 0
        ? ''
        : `${index === 0 ? 'Hardware' : 'Software'} emergency set on ${robotList.format(names)}.`
    )
    .filter(Boolean)
    .join(' ');
