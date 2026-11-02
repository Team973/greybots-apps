// Starter views, report templates and a pipeline (#148), from the starter
// dashboards #95 listed: Pit Health, Drivetrain, Shooter, Electrical, Match
// Review, Controls Debug, Automated Test and Battery Health. Named as Team
// 973's robot code logs things (DogLog under /Robot); other robots' signals
// are found by the end of their path, or by a robot mapping. They have fixed
// ids, so adding them again changes nothing.
//
// Nothing here may touch Node or the DOM.

import type { EventKind } from './events';
import type { LibraryItem, Pipeline, ReportSection, ReportTemplate, SavedView, ViewBody, ViewSpan, ViewTrace } from './library';

const robot = '/Robot/robot';
const stats = '/Robot/SystemStats';

// A trace: on the left axis (L), the right (R), or a band (top).
type Side = 'L' | 'R' | 'band';
function body(traces: [string, Side, ViewTrace['kind']?][], span: ViewSpan = { type: 'all' }, eventKinds: EventKind[] | null = null): ViewBody {
  const axes = [
    ...(traces.some(([, side]) => side === 'L') ? [{ id: 'axis1', side: 'left' as const }] : []),
    ...(traces.some(([, side]) => side === 'R') ? [{ id: 'axis2', side: 'right' as const }] : [])
  ];
  return {
    axes,
    traces: traces.map(([key, side, kind], i) => ({
      key,
      kind: kind ?? (side === 'band' ? 'boolean' : 'number'),
      axis: side === 'L' ? 'axis1' : side === 'R' ? 'axis2' : 'lanes',
      band: 'top',
      color: i
    })),
    span,
    eventKinds
  };
}

const base = (id: string, kind: LibraryItem['kind'], name: string, description: string) => ({
  id,
  kind,
  name,
  description,
  created: '2026-11-01T00:00:00.000Z',
  changed: '2026-11-01T00:00:00.000Z',
  createdBy: 'Starter',
  robot: null,
  cloud: null
});

const views: [string, string, string, ViewBody][] = [
  ['5f0c2a10-0001-4000-8000-000000000001', 'Pit Health', 'Battery and CAN use at a glance.', body([
    [`${stats}/BatteryVoltage`, 'L'],
    [`${stats}/CANBus/Utilization`, 'R'],
    [`${robot}/canivoreUtilization`, 'R'],
    [`${stats}/BrownedOut`, 'band']
  ])],
  ['5f0c2a10-0001-4000-8000-000000000002', 'Drivetrain', 'Chassis speed and each swerve module\'s drive current.', body([
    [`${robot}/drive/speedXMPS`, 'L'],
    [`${robot}/drive/speedYMPS`, 'L'],
    [`${robot}/drive/swerve/mod0/Drive Motor/supplyCurrent`, 'R'],
    [`${robot}/drive/swerve/mod1/Drive Motor/supplyCurrent`, 'R'],
    [`${robot}/drive/swerve/mod2/Drive Motor/supplyCurrent`, 'R'],
    [`${robot}/drive/swerve/mod3/Drive Motor/supplyCurrent`, 'R']
  ])],
  ['5f0c2a10-0001-4000-8000-000000000003', 'Shooter', 'Flywheel and kicker speed against target, current, and when it\'s at speed.', body([
    [`${robot}/shooter/currentLinearVelocityMPS`, 'L'],
    [`${robot}/shooter/targetLinearVelocityMPS`, 'L'],
    [`${robot}/upperKicker/currentLinearVelocityMPS`, 'L'],
    [`${robot}/shooter/motorLeader/supplyCurrent`, 'R'],
    [`${robot}/superstructure/isShooterAtSpeed`, 'band'],
    [`${robot}/shooter/state`, 'band', 'string']
  ])],
  ['5f0c2a10-0001-4000-8000-000000000004', 'Electrical', 'The battery and the roboRIO\'s rails.', body([
    [`${stats}/BatteryVoltage`, 'L'],
    [`${stats}/BrownoutVoltage`, 'L'],
    [`${stats}/BatteryCurrent`, 'R'],
    [`${stats}/5vRail/Current`, 'R'],
    [`${stats}/3v3Rail/Current`, 'R'],
    [`${stats}/BrownedOut`, 'band']
  ])],
  ['5f0c2a10-0001-4000-8000-000000000005', 'Match Review', 'What the robot was doing through the match.', body([
    [`${robot}/shooter/currentLinearVelocityMPS`, 'L'],
    [`${robot}/drive/speedXMPS`, 'L'],
    [`${stats}/BatteryVoltage`, 'R'],
    [`${robot}/superstructure/state`, 'band', 'string'],
    [`${robot}/intake/state`, 'band', 'string']
  ], { type: 'phase', phase: 'match' })],
  ['5f0c2a10-0001-4000-8000-000000000006', 'Controls Debug', 'Mechanisms\' speed against target, and their error.', body([
    [`${robot}/intake/currentVelocityRPS`, 'L'],
    [`${robot}/intake/targetVelocityRPS`, 'L'],
    [`${robot}/upperKicker/currentLinearVelocityMPS`, 'R'],
    [`${robot}/upperKicker/targetLinearVelocityMPS`, 'R'],
    [`${robot}/shooter/velocityErrorMPS`, 'R']
  ])],
  ['5f0c2a10-0001-4000-8000-000000000007', 'Automated Test', 'Drive current and the battery while the robot\'s in test mode.', body([
    [`${stats}/BatteryVoltage`, 'L'],
    [`${robot}/drive/swerve/mod0/Drive Motor/supplyCurrent`, 'R'],
    [`${robot}/drive/swerve/mod1/Drive Motor/supplyCurrent`, 'R'],
    [`${robot}/drive/swerve/mod2/Drive Motor/supplyCurrent`, 'R'],
    [`${robot}/drive/swerve/mod3/Drive Motor/supplyCurrent`, 'R']
  ])],
  ['5f0c2a10-0001-4000-8000-000000000008', 'Battery Health', 'How the battery held up: voltage against current draw.', body([
    [`${stats}/BatteryVoltage`, 'L'],
    [`${stats}/BrownoutVoltage`, 'L'],
    ['DS log/Battery voltage', 'L'],
    [`${stats}/BatteryCurrent`, 'R'],
    [`${stats}/BrownedOut`, 'band']
  ])]
];

const view = (name: string) => {
  const found = views.find(([, n]) => n === name)!;
  return { id: found[0], body: found[3] };
};
const chart = (name: string, title = name, span?: ViewSpan): ReportSection => {
  const v = view(name);
  return { type: 'chart', title, viewId: v.id, view: span ? { ...v.body, span } : v.body };
};
const problems = (title: string, kinds: EventKind[] = []): ReportSection => ({ type: 'events', title, kinds, problemsOnly: true });

const templates: [string, string, string, ReportTemplate['scope'], ReportSection[]][] = [
  ['5f0c2a10-0002-4000-8000-000000000001', 'Pit Health', 'Is the robot healthy to go out again? Battery, CAN, the roboRIO, faults.', { type: 'match' }, [
    { type: 'summary' },
    chart('Pit Health'),
    { type: 'stats', title: 'Health', keys: [`${stats}/BatteryVoltage`, `${stats}/CANBus/Utilization`, `${robot}/canivoreUtilization`, `${stats}/CPUTempCelcius`] },
    problems('Problems to look at before the next match', ['brownout', 'can', 'fault', 'network', 'overrun'])
  ]],
  ['5f0c2a10-0002-4000-8000-000000000002', 'Drivetrain', 'The drivetrain through teleop: speed, module currents, and their faults.', { type: 'teleop' }, [
    chart('Drivetrain'),
    { type: 'stats', title: 'Module drive current', keys: [0, 1, 2, 3].map((m) => `${robot}/drive/swerve/mod${m}/Drive Motor/supplyCurrent`) },
    problems('Faults and CAN', ['fault', 'can'])
  ]],
  ['5f0c2a10-0002-4000-8000-000000000003', 'Shooter', 'How well the shooter kept up with its target through teleop.', { type: 'teleop' }, [
    chart('Shooter'),
    { type: 'stats', title: 'Shooter', keys: [`${robot}/shooter/velocityErrorMPS`, `${robot}/shooter/currentLinearVelocityMPS`, `${robot}/shooter/motorLeader/supplyCurrent`] },
    { type: 'events', title: 'Its states', kinds: ['state'], problemsOnly: false }
  ]],
  ['5f0c2a10-0002-4000-8000-000000000004', 'Electrical', 'The electrical system over the match: battery, rails, brownouts.', { type: 'match' }, [
    { type: 'summary' },
    chart('Electrical'),
    { type: 'stats', title: 'Battery and rails', keys: [`${stats}/BatteryVoltage`, `${stats}/BatteryCurrent`, `${stats}/5vRail/Current`, `${stats}/3v3Rail/Current`] },
    problems('Electrical problems', ['brownout', 'can', 'fault'])
  ]],
  ['5f0c2a10-0002-4000-8000-000000000005', 'Match Review', 'The match end to end, for the drive team after it.', { type: 'match' }, [
    { type: 'heading', text: 'The match' },
    { type: 'summary' },
    chart('Match Review'),
    problems('Errors and warnings'),
    { type: 'events', title: 'Enables and notes', kinds: ['mode', 'note'], problemsOnly: false }
  ]],
  ['5f0c2a10-0002-4000-8000-000000000006', 'Controls Debug', 'Mechanisms against their targets, for tuning.', { type: 'match' }, [
    chart('Controls Debug'),
    { type: 'stats', title: 'Errors', keys: [`${robot}/shooter/velocityErrorMPS`, `${robot}/upperKicker/filteredMotorError`, `${robot}/shooter/filteredMotorError`] },
    problems('Loop overruns', ['overrun'])
  ]],
  ['5f0c2a10-0002-4000-8000-000000000007', 'Automated Test', 'While the robot\'s in test mode (#100\'s automated tests).', { type: 'conditions', conditions: [{ key: 'isTestEnabled', value: true }] }, [
    { type: 'summary' },
    chart('Automated Test'),
    { type: 'stats', title: 'Drive current', keys: [0, 1, 2, 3].map((m) => `${robot}/drive/swerve/mod${m}/Drive Motor/supplyCurrent`) },
    problems('Problems during the test')
  ]],
  ['5f0c2a10-0002-4000-8000-000000000008', 'Battery Health', 'How the battery held up, to decide if it\'s used again.', { type: 'match' }, [
    { type: 'summary' },
    chart('Battery Health'),
    { type: 'stats', title: 'Battery', keys: [`${stats}/BatteryVoltage`, `${stats}/BatteryCurrent`] },
    problems('Brownouts', ['brownout'])
  ]],
  ['5f0c2a10-0002-4000-8000-000000000009', 'Autonomous', 'Autonomous only: the path driven and what went wrong.', { type: 'auto' }, [
    chart('Drivetrain', 'Drivetrain in auto', { type: 'phase', phase: 'auto' }),
    chart('Match Review', 'Mechanisms in auto', { type: 'phase', phase: 'auto' }),
    problems('Errors and warnings in auto')
  ]]
];

const pipeline: Pipeline = {
  ...base('5f0c2a10-0003-4000-8000-000000000001', 'pipeline', 'After each qualification match',
    'Match Review and Pit Health for every qualification match offloaded. Off until someone turns it on.'),
  kind: 'pipeline',
  enabled: false,
  onOffload: true,
  onImport: false,
  robots: [],
  matchTypes: ['qualification'],
  templateIds: ['5f0c2a10-0002-4000-8000-000000000005', '5f0c2a10-0002-4000-8000-000000000001']
};

export function starterLibrary(): LibraryItem[] {
  return [
    ...views.map(([id, name, description, b]): SavedView => ({ ...base(id, 'view', name, description), kind: 'view', ...b })),
    ...templates.map(([id, name, description, scope, sections]): ReportTemplate => ({ ...base(id, 'template', name, description), kind: 'template', scope, sections })),
    pipeline
  ];
}
