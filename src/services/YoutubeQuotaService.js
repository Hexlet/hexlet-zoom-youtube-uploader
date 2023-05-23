import { DateTime } from 'luxon';
import _ from 'lodash';
import { AppError } from '../utils/errors.js';

const getDay = () => DateTime.now()
  .setZone('America/Los_Angeles') // квоты сбрасываются в полночь по Pacific Time, но об этом не сказано в документации
  .get('day');

// TODO: повыпиливать console.log
export class YoutubeQuotaService {
  // https://developers.google.com/youtube/v3/determine_cost
  static LIMIT = 10_000;

  static LIMIT_EXCEEDED = 0;

  static COST_PLAYLISTS_LIST = 1;

  static COST_PLAYLISTS_INSERT = 50;

  static COST_PLAYLISTITEMS_INSERT = 50;

  static COST_VIDEOS_INSERT = 1_600;

  constructor({ lastUpdateDay = null, rest = null } = {}) {
    console.log('YoutubeQuotaService', { lastUpdateDay, rest });
    this.lastUpdateDay = (lastUpdateDay === null) ? getDay() : lastUpdateDay;
    this.rest = (rest === null) ? this.constructor.LIMIT : rest;
    this.eventCostMap = new Map([
      ['videos.insert', this.constructor.COST_VIDEOS_INSERT],
      ['playlists.list', this.constructor.COST_PLAYLISTS_LIST],
      ['playlists.insert', this.constructor.COST_PLAYLISTS_INSERT],
      ['playlistitems.insert', this.constructor.COST_PLAYLISTITEMS_INSERT],
    ]);
  }

  setExceeded() {
    console.log('setExceeded', { rest: this.rest });
    this.rest = this.constructor.LIMIT_EXCEEDED;
  }

  check(...events) {
    console.log('check', { events });
    const hasOnlyExpectedEvents = events.every((event) => this.eventCostMap.has(event));
    if (!hasOnlyExpectedEvents) {
      throw new AppError(`Event list has unexpected items. events=${events.join(',')}`);
    }
    const costs = events.map((event) => this.eventCostMap.get(event));
    const cost = _.sum(costs);
    console.log('check', { costs, cost });

    return this.calc(cost);
  }

  calc(cost) {
    console.log('check', { cost, rest: this.rest, lastUpdateDay: this.lastUpdateDay });
    if (!(cost && (typeof cost === 'number'))) {
      throw new AppError('Cost must be number and required argument');
    }

    const nowDay = getDay();
    const isNewDay = (this.lastUpdateDay !== nowDay);
    console.log('check', { nowDay, isNewDay });

    if (isNewDay) {
      this.rest = this.constructor.LIMIT;
      this.lastUpdateDay = nowDay;
    }

    return (this.rest >= cost);
  }

  pay(event) {
    console.log('pay', { rest: this.rest, event });
    const hasQuota = this.check(event);
    const cost = this.eventCostMap.get(event);
    console.log('pay', { hasQuota, cost });
    if (hasQuota) {
      this.rest -= cost;
    }
    console.log('pay', { rest: this.rest });

    return hasQuota;
  }
}
