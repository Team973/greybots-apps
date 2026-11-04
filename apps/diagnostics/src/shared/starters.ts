// Starter views, report templates and a pipeline (#148). The views are the
// starter dashboards #95 listed: Pit Health, Drivetrain, Shooter, Electrical,
// Match Review, Controls Debug, Automated Test and Battery Health, and an
// Energy view with pies of what each motor drew. The
// templates are Match Report (Pit Health, Battery Health and the
// mechanisms together), Match Review, Autonomous and Power Analysis. Named as Team
// 973's robot code logs things (DogLog under /Robot); other robots' signals
// are found by the end of their path, or by a robot mapping. They have fixed
// ids, so adding them again changes nothing.
//
// Nothing here may touch Node or the DOM.

import type { EventKind } from './events';
import type { LibraryItem, Pipeline, ReportSection, ReportTemplate, SavedView, ViewBody, ViewSpan, ViewTrace } from './library';
import type { PiePanel } from './plots';

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

// Each motor's supply current, the battery's current it draws: by motor,
// and added up by subsystem.
const motors: [string, string][] = [
  ...[0, 1, 2, 3].map((m): [string, string] => [`Module ${m} drive`, `${robot}/drive/swerve/mod${m}/Drive Motor/supplyCurrent`]),
  ...[0, 1, 2, 3].map((m): [string, string] => [`Module ${m} angle`, `${robot}/drive/swerve/mod${m}/Angle Motor/supplyCurrent`]),
  ['Intake left roller', `${robot}/intake/leftRollerMotor/supplyCurrent`],
  ['Intake right roller', `${robot}/intake/rightRollerMotor/supplyCurrent`],
  ['Intake arm left', `${robot}/intakeArm/left/motor/supplyCurrent`],
  ['Intake arm right', `${robot}/intakeArm/right/motor/supplyCurrent`],
  ['Shooter leader', `${robot}/shooter/motorLeader/supplyCurrent`],
  ['Shooter follower', `${robot}/shooter/motorFollower/supplyCurrent`],
  ['Conveyor', `${robot}/conveyor/motor/supplyCurrent`],
  ['Queuer', `${robot}/queuer/Motor/supplyCurrent`],
  ['Upper kicker', `${robot}/upperKicker/motor/supplyCurrent`],
  ['Lower kicker', `${robot}/lowerKicker/motor/supplyCurrent`]
];
// The same motors as their TalonFXs log themselves in the Hoot logs, by CAN
// id: told apart on Q39 by how alike each one's supply current is to the
// robot code's, and by their averages (the kickers and shooter's). Found
// by the end of the name, whatever the CANivore's serial is.
const talons: Record<string, number> = {
  'Module 0 drive': 2, 'Module 0 angle': 3, 'Module 2 drive': 5, 'Module 2 angle': 6,
  'Module 1 drive': 8, 'Module 1 angle': 9, 'Module 3 drive': 11, 'Module 3 angle': 12,
  Queuer: 20, Conveyor: 30, 'Upper kicker': 40, 'Lower kicker': 41, 'Intake arm left': 50, 'Intake arm right': 52,
  'Shooter leader': 58, 'Shooter follower': 59, 'Intake right roller': 60, 'Intake left roller': 61
};
const talonCurrent = (name: string) => `TalonFX-${talons[name]}/SupplyCurrent`;

const subsystems: [string, string[]][] = [
  ['Drive motors', ['Module 0 drive', 'Module 1 drive', 'Module 2 drive', 'Module 3 drive']],
  ['Angle motors', ['Module 0 angle', 'Module 1 angle', 'Module 2 angle', 'Module 3 angle']],
  ['Intake rollers', ['Intake left roller', 'Intake right roller']],
  ['Intake arm', ['Intake arm left', 'Intake arm right']],
  ['Shooter', ['Shooter leader', 'Shooter follower']],
  ['Conveyor', ['Conveyor']],
  ['Queuer', ['Queuer']],
  ['Kickers', ['Upper kicker', 'Lower kicker']]
];
const keyOf = new Map(motors);

// Energy pies, by motor and by subsystem: the robot code's currents times
// the battery's voltage, or the Hoot logs' currents times each Talon's own.
// The Signals page's view of the same: the battery on the chart, and pies of
// the energy each motor and subsystem drew over the span shown, as tabs.
const battery = `${stats}/BatteryVoltage`;
const energyPie = (id: string, title: string, groups: [string, string[]][]): PiePanel =>
  ({ id, type: 'pie', title, mode: 'share', keys: [], groups: groups.map(([label, keys]) => ({ label, keys })), measure: 'energy', voltage: battery });
const energyView: [string, string, string, ViewBody] = ['5f0c2a10-0001-4000-8000-000000000009', 'Energy',
  "The battery, and the energy each motor and subsystem drew over the span shown (their supply current times the battery's voltage) in the pie tabs.", {
    ...body([
      [battery, 'L'],
      [`${stats}/BatteryCurrent`, 'R'],
      [`${stats}/BrownedOut`, 'band']
    ]),
    panels: [
      energyPie('panel1', 'Energy by motor', motors.map(([name, key]) => [name, [key]])),
      energyPie('panel2', 'Energy by subsystem', subsystems.map(([label, names]) => [label, names.map((name) => keyOf.get(name)!)]))
    ]
  }];

function energyPies(source: string, key: (name: string) => string, voltage: string): ReportSection[] {
  return [
    { type: 'pie', title: `Energy by motor${source}`, measure: 'energy', voltage, slices: motors.map(([name]) => ({ label: name, keys: [key(name)] })) },
    { type: 'pie', title: `Energy by subsystem${source}`, measure: 'energy', voltage, slices: subsystems.map(([label, names]) => ({ label, keys: names.map(key) })) }
  ];
}

const templates: [string, string, string, ReportTemplate['scope'], ReportSection[]][] = [
  ['5f0c2a10-0002-4000-8000-000000000010', 'Match Report', 'Is the robot ready for the next match? Its health, the battery, and how the mechanisms did.', { type: 'match' }, [
    { type: 'summary' },
    chart('Pit Health', 'Battery and CAN'),
    { type: 'stats', title: 'Health', keys: [`${stats}/BatteryVoltage`, `${stats}/BatteryCurrent`, `${stats}/CANBus/Utilization`, `${robot}/canivoreUtilization`, `${stats}/CPUTempCelcius`] },
    chart('Battery Health', 'The battery: voltage against current drawn'),
    chart('Shooter', 'Shooter'),
    chart('Controls Debug', 'Mechanisms against their targets'),
    { type: 'stats', title: 'Mechanism error', keys: [`${robot}/shooter/velocityErrorMPS`, `${robot}/shooter/filteredMotorError`, `${robot}/upperKicker/filteredMotorError`] }
  ]],
  ['5f0c2a10-0002-4000-8000-000000000005', 'Match Review', 'The match end to end, for the drive team after it.', { type: 'match' }, [
    { type: 'heading', text: 'The match' },
    { type: 'summary' },
    chart('Match Review'),
    problems('Errors and warnings'),
    { type: 'events', title: 'Enables and notes', kinds: ['mode', 'note'], problemsOnly: false }
  ]],
  ['5f0c2a10-0002-4000-8000-000000000009', 'Autonomous', 'Autonomous only: the path driven and what went wrong.', { type: 'auto' }, [
    chart('Drivetrain', 'Drivetrain in auto', { type: 'phase', phase: 'auto' }),
    chart('Match Review', 'Mechanisms in auto', { type: 'phase', phase: 'auto' }),
    problems('Errors and warnings in auto')
  ]],
  ['5f0c2a10-0002-4000-8000-000000000011', 'Power Analysis', "Where the battery's energy goes over the match, in watt-hours: each motor's share, and each subsystem's. From the robot code's log (each motor's supply current times the battery's voltage), and from the Hoot logs alone (each TalonFX's own supply voltage and current).", { type: 'match' }, [
    { type: 'summary' },
    problems('Errors and warnings'),
    { type: 'heading', text: "From the robot code's log" },
    { type: 'text', text: "Each motor's supply current, as the robot code logs it, times the battery's voltage." },
    ...energyPies('', (name) => keyOf.get(name)!, `${stats}/BatteryVoltage`),
    { type: 'heading', text: 'From the Hoot logs' },
    { type: 'text', text: "Each TalonFX's supply voltage times its supply current, as it logs them itself: sampled faster than the robot code logs them, and with no part from the robot code." },
    ...energyPies(' (Hoot)', talonCurrent, '')
  ]]
];

const pipeline: Pipeline = {
  ...base('5f0c2a10-0003-4000-8000-000000000001', 'pipeline', 'After each qualification match',
    'Match Review and Match Report for every qualification match offloaded. Off until someone turns it on.'),
  kind: 'pipeline',
  enabled: false,
  onOffload: true,
  onImport: false,
  robots: [],
  matchTypes: ['qualification'],
  templateIds: ['5f0c2a10-0002-4000-8000-000000000005', '5f0c2a10-0002-4000-8000-000000000010']
};

export function starterLibrary(): LibraryItem[] {
  return [
    ...[...views, energyView].map(([id, name, description, b]): SavedView => ({ ...base(id, 'view', name, description), kind: 'view', ...b })),
    ...templates.map(([id, name, description, scope, sections]): ReportTemplate => ({ ...base(id, 'template', name, description), kind: 'template', scope, sections })),
    pipeline
  ];
}
