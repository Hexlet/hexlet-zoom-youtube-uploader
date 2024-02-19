import ms from 'ms';
import { CronService } from '../services/CronService.js';
import * as download from './download.js';
import * as upload from './upload.js';
import * as deleting from './delete.js';

export const initTasks = (server) => [
  // download.task(server),
  // upload.task(server),
  // deleting.task(server),
].map((task) => new CronService(
  task,
  ms(server.config.CRON_PERIOD),
  ms(server.config.CRON_DELAY),
));
