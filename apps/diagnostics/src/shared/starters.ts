// Starter views, report templates and a pipeline (#148). The views are the
// starter dashboards #95 listed: Pit Health, Drivetrain, Shooter, Electrical,
// Match Review, Controls Debug, Automated Test and Battery Health, and an
// Energy view with pies of what each motor drew. The
// templates are Match Report (Pit Health, Battery Health and the
// mechanisms together), Match Review, Autonomous and Power Analysis. Named as Team
// 973's robot code logs things (DogLog under /Robot); other robots' signals
// are found by the end of their path. They have fixed
// ids, so adding them again changes nothing.
//
// Nothing here may touch Node or the DOM.

import type { DeviceSpec } from './devices';
import type { EventKind } from './events';
import type { LibraryItem, Pipeline, ReportSection, ReportTemplate, SavedView, ViewBody, ViewSpan, ViewTrace } from './library';
import type { PiePanel } from './plots';
import type { SymmetryPairSpec } from './symmetry';

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

// When the starters were first made. A starter in a library still stamped
// with this or a later revision's time (all midnight, UTC), and by
// "Starter", hasn't been changed by anyone (outdatedStarter).
export const starterStamp = '2026-11-01T00:00:00.000Z';

// Starters changed since, and when. A copy nobody has changed is brought up
// to date (see upgradeStarters); a changed one is left as its owner made it.
//   Power Analysis: over the time the robot is enabled, not the whole log;
//     and only power problems (brownouts, voltage, supply current), not
//     wheel slip or the cameras.
//   Autonomous: path tracking error and the path and surf monitors.
//   Match Report: the monitors, and the log's errors and warnings.
//   Power Analysis again: only the battery's problems (titled so); Match
//   Report: the Pigeon and CANivore.
export const starterRevisions: Record<string, string> = {
  '5f0c2a10-0002-4000-8000-000000000011': '2026-11-11T00:00:00.000Z',
  '5f0c2a10-0002-4000-8000-000000000009': '2026-11-08T00:00:00.000Z',
  '5f0c2a10-0002-4000-8000-000000000010': '2026-11-11T00:00:00.000Z'
};

// Starters added since the first ones: put in a library once by
// themselves (see upgradeStarters), and not again if someone deletes them.
//   The Path Tracking view, and the Vision System and Device Health templates.
//   The Network Connectivity, Intake, Shooter and Drivetrain templates, and
//   their views (Network, Radio, Intake Arm, Intake Rollers, Shooter
//   Flywheel, Kickers, and Swerve Module 0 to 3).
export const newStarters: string[] = [
  '5f0c2a10-0001-4000-8000-000000000010', '5f0c2a10-0002-4000-8000-000000000012', '5f0c2a10-0002-4000-8000-000000000013',
  ...[11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((n) => `5f0c2a10-0001-4000-8000-${String(n).padStart(12, '0')}`),
  ...[14, 15, 16, 17].map((n) => `5f0c2a10-0002-4000-8000-${String(n).padStart(12, '0')}`)
];

const base = (id: string, kind: LibraryItem['kind'], name: string, description: string) => ({
  id,
  kind,
  name,
  description,
  created: starterStamp,
  changed: starterRevisions[id] ?? starterStamp,
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

// Added later (see newStarters).
views.push(
  ['5f0c2a10-0001-4000-8000-000000000010', 'Path Tracking', 'How far the robot was from the path it followed: X and Y position error, and heading error.', body([
    [`${robot}/drive/controller/driveWithTrajectory/X Position Error`, 'L'],
    [`${robot}/drive/controller/driveWithTrajectory/Y Position Error`, 'L'],
    [`${robot}/drive/controller/driveWithTrajectory/Theta Position Error`, 'R']
  ], { type: 'phase', phase: 'auto' })]
);

// For the Network Connectivity, Intake, Shooter and Drivetrain reports
// (newStarters).
const ds = 'DS log';
const arm = `${robot}/intakeArm`;
const intake = `${robot}/intake`;
const swerveModule = (m: number) => `${robot}/drive/swerve/mod${m}`;
views.push(
  ['5f0c2a10-0001-4000-8000-000000000011', 'Network', "The Driver Station's link to the robot: trip time and packet loss, and whether the robot and its radio were there.", body([
    [`${ds}/Trip time`, 'L'],
    [`${ds}/Packet loss`, 'R'],
    [`${ds}/Robot connected`, 'band'],
    ['/Robot/RadioStatus/Connected', 'band']
  ], { type: 'phase', phase: 'match' })],
  ['5f0c2a10-0001-4000-8000-000000000012', 'Radio', 'Wi-Fi signal and bandwidth, as the Driver Station has them (only on a field).', body([
    [`${ds}/Wi-Fi signal`, 'L'],
    [`${ds}/Bandwidth`, 'R']
  ], { type: 'phase', phase: 'match' })],
  ['5f0c2a10-0001-4000-8000-000000000013', 'Intake Arm', "The intake arm's two motors: each one's position against the target, and their current.", body([
    [`${arm}/left/currentPositionMotorRot`, 'L'],
    [`${arm}/right/currentPositionMotorRot`, 'L'],
    [`${arm}/targetPositionMotorRot`, 'L'],
    [`${arm}/left/motor/statorCurrent`, 'R'],
    [`${arm}/right/motor/statorCurrent`, 'R'],
    [`${arm}/state`, 'band', 'string']
  ])],
  ['5f0c2a10-0001-4000-8000-000000000014', 'Intake Rollers', "The intake rollers' two motors' current, and the rollers' speed against target.", body([
    [`${intake}/leftRollerMotor/statorCurrent`, 'L'],
    [`${intake}/rightRollerMotor/statorCurrent`, 'L'],
    [`${intake}/currentVelocityRPS`, 'R'],
    [`${intake}/targetVelocityRPS`, 'R'],
    [`${intake}/state`, 'band', 'string']
  ])],
  ['5f0c2a10-0001-4000-8000-000000000015', 'Shooter Flywheel', "The flywheel's command vs. feedback (target and actual speed), and its two motors' current.", body([
    [`${robot}/shooter/targetLinearVelocityMPS`, 'L'],
    [`${robot}/shooter/currentLinearVelocityMPS`, 'L'],
    [`${robot}/shooter/motorLeader/statorCurrent`, 'R'],
    [`${robot}/shooter/motorFollower/statorCurrent`, 'R'],
    [`${robot}/superstructure/isShooterAtSpeed`, 'band'],
    [`${robot}/shooter/state`, 'band', 'string']
  ])],
  ['5f0c2a10-0001-4000-8000-000000000016', 'Kickers', "The upper and lower kickers' command vs. feedback (target and actual speed), and their current.", body([
    [`${robot}/upperKicker/targetLinearVelocityMPS`, 'L'],
    [`${robot}/upperKicker/currentLinearVelocityMPS`, 'L'],
    [`${robot}/lowerKicker/targetLinearVelocityMPS`, 'L'],
    [`${robot}/lowerKicker/currentLinearVelocityMPS`, 'L'],
    [`${robot}/upperKicker/motor/statorCurrent`, 'R'],
    [`${robot}/lowerKicker/motor/statorCurrent`, 'R']
  ])],
  // Each swerve module: its drive's speed (left axis) and its angle (right
  // axis), each against what it was told.
  ...[0, 1, 2, 3].map((m): [string, string, string, ViewBody] => [`5f0c2a10-0001-4000-8000-${String(17 + m).padStart(12, '0')}`,
    `Swerve Module ${m}`, `Module ${m}: its drive speed, command vs. feedback (left axis), and its angle, command vs. feedback (right axis).`, body([
      [`${swerveModule(m)}/drive/targetVelMPS`, 'L'],
      [`${swerveModule(m)}/drive/currentVelMPS`, 'L'],
      [`${swerveModule(m)}/steer/targetPosRot`, 'R'],
      [`${swerveModule(m)}/steer/currentPosRot`, 'R']
    ])])
);

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

// Every CAN device on the robot, for Device Health: the TalonFXs above (the
// intake rollers' on the roboRIO's bus, the rest on the CANivore), each swerve
// module's CANcoder (by CAN id, after its module's motors: 4 after module 0's
// 2 and 3), and the Pigeon. As in mttd Q9's Hoot logs.
const robotDevices: DeviceSpec[] = [
  ...Object.entries(talons).map(([label, id]): DeviceSpec => ({ device: `TalonFX-${id}`, label, bus: id >= 60 ? 'rio' : 'canivore' })),
  { device: 'CANcoder-4', label: 'Module 0 encoder', bus: 'canivore' },
  { device: 'CANcoder-7', label: 'Module 2 encoder', bus: 'canivore' },
  { device: 'CANcoder-10', label: 'Module 1 encoder', bus: 'canivore' },
  { device: 'CANcoder-13', label: 'Module 3 encoder', bus: 'canivore' },
  { device: 'Pigeon2-1', label: 'Pigeon (heading)', bus: 'canivore' }
];

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
    { type: 'monitors', title: 'Monitors', ids: [] },
    problems('Errors and warnings'),
    // The Pigeon (heading) and the CANivore (the drive's and Pigeon's bus):
    // any fault on either is an error.
    { type: 'events', title: 'Pigeon and CANivore', kinds: ['fault', 'can'], problemsOnly: true, topic: 'pigeon-canivore' },
    // The Pigeon there, logging and without faults: missing is an error, not a signal missing.
    { type: 'devices', title: 'Pigeon', devices: robotDevices.filter((d) => d.device.startsWith('Pigeon2-')) },
    { type: 'stats', title: 'CANivore', keys: [`${robot}/canivoreUtilization`, `${robot}/canivoreTXFullCount`] },
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
    chart('Path Tracking', 'Path tracking error in auto', { type: 'phase', phase: 'auto' }),
    { type: 'stats', title: 'Path tracking error', keys: [
      `${robot}/drive/controller/driveWithTrajectory/X Position Error`,
      `${robot}/drive/controller/driveWithTrajectory/Y Position Error`,
      `${robot}/drive/controller/driveWithTrajectory/Theta Position Error`
    ] },
    { type: 'monitors', title: 'Path tracking and surfing', ids: ['path-position', 'path-heading', 'surf', 'surf-near-miss'] },
    problems('Errors and warnings in auto')
  ]],
  ['5f0c2a10-0002-4000-8000-000000000012', 'Vision System', 'Each camera: how often it had good data and used it, against thrown out; when, as a heatmap; and how far its measurements were from the fused pose.', { type: 'match' }, [
    { type: 'summary' },
    { type: 'vision', title: 'Cameras' },
    { type: 'monitors', title: 'Disagreeing with the fused pose', ids: ['vision-disagreement'] }
  ]],
  ['5f0c2a10-0002-4000-8000-000000000013', 'Device Health', "Is every CAN device there, logging and healthy? Each must be in its bus's Hoot log, logging all match, with no fault while it's on: any of those, or a log missing, is an error.", { type: 'match' }, [
    { type: 'summary' },
    { type: 'devices', title: 'Devices', devices: robotDevices }
  ]],
  ['5f0c2a10-0002-4000-8000-000000000011', 'Power Analysis', "Where the battery's energy goes while the robot is enabled, in watt-hours: each motor's share, and each subsystem's. From the robot code's log (each motor's supply current times the battery's voltage), and from the Hoot logs alone (each TalonFX's own supply voltage and current).", { type: 'enabled' }, [
    { type: 'summary' },
    { type: 'events', title: 'Battery problems', kinds: [], problemsOnly: true, topic: 'power' },
    { type: 'heading', text: "From the robot code's log" },
    { type: 'text', text: "Each motor's supply current, as the robot code logs it, times the battery's voltage." },
    ...energyPies('', (name) => keyOf.get(name)!, `${stats}/BatteryVoltage`),
    { type: 'heading', text: 'From the Hoot logs' },
    { type: 'text', text: "Each TalonFX's supply voltage times its supply current, as it logs them itself: sampled faster than the robot code logs them, and with no part from the robot code." },
    ...energyPies(' (Hoot)', talonCurrent, '')
  ]]
];

// Pairs for symmetry sections: two signals that should match.
const pair = (label: string, a: string, b: string, activeAbove: number | null = null, magnitude = false): SymmetryPairSpec =>
  ({ label, a, b, activeAbove, magnitude });
// A mechanism's command against its feedback: what it was told, against
// what it did, while either is above `activeAbove` (so sitting still isn't
// counted as tracking well), and only while its state is `state` if given
// (the shooter's, kickers' and rollers' targets are worked out even while
// they're off, so only in ClosedLoop are they held to them).
const commanded = (label: string, target: string, actual: string, activeAbove: number | null, state?: string): SymmetryPairSpec =>
  ({ ...pair(label, target, actual, activeAbove), ...(state ? { onlyWhile: { key: state, value: 'ClosedLoop' } } : {}) });

templates.push(
  ['5f0c2a10-0002-4000-8000-000000000014', 'Network Connectivity', "Was the robot reachable all match? The Driver Station's trip time and packet loss, the radio, and every network problem: the robot lost, a poor link, NetworkTables clients leaving.", { type: 'match' }, [
    { type: 'summary' },
    { type: 'events', title: 'Network events', kinds: ['network'], problemsOnly: false },
    chart('Network', 'Trip time and packet loss'),
    { type: 'stats', title: 'The link', keys: [`${ds}/Trip time`, `${ds}/Packet loss`, `${ds}/Wi-Fi signal`, `${ds}/Bandwidth`] },
    chart('Radio', 'Wi-Fi signal and bandwidth (on a field)')
  ]],
  ['5f0c2a10-0002-4000-8000-000000000015', 'Intake', "The intake while the robot is enabled: are the arm's two motors and the two rollers alike (position and current), and did the arm skip (read past its hard stop)?", { type: 'enabled' }, [
    { type: 'summary' },
    { type: 'monitors', title: 'Intake checks', ids: ['intake-arm-skip', 'intake-arm-twist', 'pair-intake-arm', 'pair-intake-rollers'] },
    { type: 'symmetry', title: 'Intake arm: left vs. right', pairs: [
      pair('Position', `${arm}/left/currentPositionMotorRot`, `${arm}/right/currentPositionMotorRot`),
      pair('Current (stator), while running', `${arm}/left/motor/statorCurrent`, `${arm}/right/motor/statorCurrent`, 5, true),
      pair('Current (supply), while running', `${arm}/left/motor/supplyCurrent`, `${arm}/right/motor/supplyCurrent`, 2, true)
    ] },
    chart('Intake Arm', 'Intake arm'),
    { type: 'stats', title: 'Intake arm position', keys: [`${arm}/left/currentPositionMotorRot`, `${arm}/right/currentPositionMotorRot`, `${arm}/leftMinusRightMotorRot`] },
    { type: 'symmetry', title: 'Intake rollers: left vs. right', pairs: [
      pair('Current (stator), while running', `${intake}/leftRollerMotor/statorCurrent`, `${intake}/rightRollerMotor/statorCurrent`, 5, true),
      pair('Current (supply), while running', `${intake}/leftRollerMotor/supplyCurrent`, `${intake}/rightRollerMotor/supplyCurrent`, 2, true),
      pair('Speed, while running', `${intake}/leftRollerMotor/velocity`, `${intake}/rightRollerMotor/velocity`, 1, true)
    ] },
    chart('Intake Rollers', 'Intake rollers'),
    { type: 'symmetry', title: 'Rollers: command vs. feedback', pairs: [
      commanded('Roller speed, in closed loop', `${intake}/targetVelocityRPS`, `${intake}/currentVelocityRPS`, null, `${intake}/state`)
    ] }
  ]],
  ['5f0c2a10-0002-4000-8000-000000000016', 'Shooter', "The shooter while the robot is enabled: the flywheel's and kickers' command vs. feedback, and whether its two motors share the load.", { type: 'enabled' }, [
    { type: 'summary' },
    { type: 'symmetry', title: 'Command vs. feedback', pairs: [
      commanded('Flywheel, in closed loop', `${robot}/shooter/targetLinearVelocityMPS`, `${robot}/shooter/currentLinearVelocityMPS`, null, `${robot}/shooter/state`),
      commanded('Upper kicker, in closed loop', `${robot}/upperKicker/targetLinearVelocityMPS`, `${robot}/upperKicker/currentLinearVelocityMPS`, null, `${robot}/upperKicker/state`),
      commanded('Lower kicker, in closed loop', `${robot}/lowerKicker/targetLinearVelocityMPS`, `${robot}/lowerKicker/currentLinearVelocityMPS`, null, `${robot}/lowerKicker/state`)
    ] },
    chart('Shooter Flywheel', 'Flywheel: command vs. feedback'),
    chart('Kickers', 'Kickers: command vs. feedback'),
    { type: 'stats', title: 'Speed error', keys: [`${robot}/shooter/velocityErrorMPS`, `${robot}/shooter/filteredMotorError`, `${robot}/upperKicker/filteredMotorError`, `${robot}/lowerKicker/filteredMotorError`] },
    { type: 'symmetry', title: 'Flywheel motors: leader vs. follower', pairs: [
      pair('Current (stator), while running', `${robot}/shooter/motorLeader/statorCurrent`, `${robot}/shooter/motorFollower/statorCurrent`, 5, true),
      pair('Speed, while running', `${robot}/shooter/motorLeader/velocity`, `${robot}/shooter/motorFollower/velocity`, 1, true)
    ] },
    { type: 'monitors', title: 'Shooter checks', ids: ['pair-shooter'] }
  ]],
  ['5f0c2a10-0002-4000-8000-000000000017', 'Drivetrain', "Each swerve module while the robot is enabled: its drive speed and angle, command vs. feedback, and whether a module or wheel was unlike the rest.", { type: 'enabled' }, [
    { type: 'summary' },
    { type: 'symmetry', title: 'Command vs. feedback', pairs: [0, 1, 2, 3].flatMap((m) => [
      commanded(`Module ${m} drive speed`, `${swerveModule(m)}/drive/targetVelMPS`, `${swerveModule(m)}/drive/currentVelMPS`, 0.1),
      commanded(`Module ${m} angle`, `${swerveModule(m)}/steer/targetPosRot`, `${swerveModule(m)}/steer/currentPosRot`, null)
    ]) },
    ...[0, 1, 2, 3].map((m) => chart(`Swerve Module ${m}`, `Module ${m}: drive speed (left axis) and angle (right axis), command vs. feedback`)),
    { type: 'monitors', title: 'Drivetrain checks', ids: ['swerve-outlier', 'wheel-slip', 'wheel-drag'] }
  ]]
);

const pipeline: Pipeline = {
  ...base('5f0c2a10-0003-4000-8000-000000000001', 'pipeline', 'After each qualification match',
    'Every report template on every qualification match downloaded. Off until someone turns it on.'),
  kind: 'pipeline',
  enabled: false,
  onOffload: true,
  onImport: false,
  robots: [],
  matchTypes: ['qualification'],
  templateIds: ['5f0c2a10-0002-4000-8000-000000000005', '5f0c2a10-0002-4000-8000-000000000010'],
  several: 'all'
};

export function starterLibrary(): LibraryItem[] {
  return [
    ...[...views, energyView].map(([id, name, description, b]): SavedView => ({ ...base(id, 'view', name, description), kind: 'view', ...b })),
    ...templates.map(([id, name, description, scope, sections]): ReportTemplate => ({ ...base(id, 'template', name, description), kind: 'template', scope, sections })),
    pipeline
  ];
}

// Whether a starter kept in a library should be replaced by the starter as
// it is now: nobody has changed it, and the starter has changed since.
// Kept as a starter was (added, or brought up to date since), and older than
// it is now. Starters' times are all midnight (UTC); one someone changed has
// the time they saved it, and stays theirs.
const starterTime = (time: string) => time.endsWith('T00:00:00.000Z');
export function outdatedStarter(kept: LibraryItem, starter: LibraryItem): boolean {
  return kept.id === starter.id && kept.createdBy === 'Starter' && starterTime(kept.changed) && kept.changed < starter.changed;
}
