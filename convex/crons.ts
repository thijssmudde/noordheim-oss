import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
crons.interval(
  'Recover stalled battles',
  { seconds: 10 },
  internal.tactics.recoverStalledSectors,
);
crons.interval(
  'Purge abandoned operations and idle commanders',
  { minutes: 5 },
  internal.cleanup.purgeAbandoned,
);
export default crons;
