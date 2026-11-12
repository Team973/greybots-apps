// Turbo download: the robot program paused (SIGSTOP) while its logs come
// down, so the download isn't sharing the roboRIO's CPU and disk with it,
// then let go again (SIGCONT). A stopped process stays stopped only while it
// lives: rebooting the robot, Restart Robot Code in the Driver Station or
// deploying code all start it afresh, so the robot can't be left paused for
// good. Only ever asked for by someone pressing the button, and only with
// the robot disabled and not on a field (FMS): pausing it never stops a
// robot that's moving, but it does stop one from being enabled until the
// download's done.
//
// Nothing here may touch Node or the DOM.

// WPILib's control word, as robot code publishes it to NetworkTables
// (/FMSInfo/FMSControlData): HAL_ControlWord's bits.
export interface RobotControl {
  enabled: boolean;
  autonomous: boolean;
  test: boolean;
  eStop: boolean;
  fmsAttached: boolean;
  dsAttached: boolean;
}

export const controlWordTopic = '/FMSInfo/FMSControlData';

export function controlWord(value: number): RobotControl {
  return {
    enabled: (value & 0x01) !== 0,
    autonomous: (value & 0x02) !== 0,
    test: (value & 0x04) !== 0,
    eStop: (value & 0x08) !== 0,
    fmsAttached: (value & 0x10) !== 0,
    dsAttached: (value & 0x20) !== 0
  };
}

// Why it mustn't be paused now, or '' when it may.
export function turboRefusal(control: RobotControl | null): string {
  if (!control) return "Couldn't read whether the robot is enabled (robot code isn't answering on NetworkTables), so it wasn't paused.";
  if (control.fmsAttached) return "The robot is on a field (FMS attached): its code wasn't paused.";
  if (control.enabled) return 'The robot is enabled: its code wasn\'t paused. Disable it and try again.';
  return '';
}

// Run on the robot (as lvuser, which runs the robot program): each of our
// own processes that's a robot program, as "<pid> <program>": a C++
// program in /home/lvuser, Java (WPILib's JRE), or Python (RobotPy).
// Others' processes can't be read, so aren't listed; this shell is skipped.
export const findRobotProgramScript = [
  'for d in /proc/[0-9]*; do',
  '  p=${d#/proc/}',
  '  [ "$p" = "$$" ] && continue',
  '  exe=$(readlink "$d/exe" 2>/dev/null) || continue',
  '  case "$exe" in',
  '    /home/lvuser/*|*/frc/JRE/bin/java|*/bin/java|*/python3*) echo "$p $exe" ;;',
  '  esac',
  'done'
].join('\n');

export interface RobotProcess {
  pid: number;
  program: string;
}

export function parseRobotPrograms(output: string): RobotProcess[] {
  return output.split('\n').flatMap((line) => {
    const found = /^(\d+) (\S.*)$/.exec(line.trim());
    return found ? [{ pid: Number(found[1]), program: found[2] }] : [];
  });
}

// The signal sent to them: stopped, or carrying on. Only numbers go in.
export function signalCommand(signal: 'STOP' | 'CONT', pids: number[]): string {
  const safe = pids.filter((pid) => Number.isInteger(pid) && pid > 1);
  return `kill -${signal} ${safe.join(' ')}`;
}

// Which of them are stopped (state T in /proc/<pid>/stat), one pid a line:
// after pausing, all of them should be; after resuming, none. A process
// that's gone isn't listed.
export function stoppedCheckScript(pids: number[]): string {
  const safe = pids.filter((pid) => Number.isInteger(pid) && pid > 1);
  return `for p in ${safe.join(' ')}; do s=$(cut -d' ' -f3 /proc/$p/stat 2>/dev/null); [ "$s" = T ] && echo $p; done; true`;
}

export const parsePids = (output: string): number[] =>
  output.split('\n').map((line) => Number(line.trim())).filter((pid) => Number.isInteger(pid) && pid > 0);

// How a turbo download's pause went, for the page.
export interface TurboState {
  // checking: reading the robot's state; paused: stopped while downloading;
  // resumed: going again; refused: not paused (why's in message);
  // resume-failed: couldn't be told to go again (restart robot code).
  state: 'checking' | 'paused' | 'resumed' | 'refused' | 'resume-failed';
  host: string;
  pids: number[];
  programs: string[];
  at: string;
  message: string;
}
