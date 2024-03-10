import * as luxon from 'luxon';
import flat from 'flat';
import yup from 'yup';
import {
  BadRequestError,
} from '../utils/errors.js';

const { DateTime } = luxon;

const formatEnum = {
  json: 'json',
  tsv: 'tsv',
  html: 'html',
};

const handlerByFormat = {
  [formatEnum.json]: (records) => records,
  [formatEnum.tsv]: (records) => {
    if (records.length === 0) return '';
    const headersStartRow = '';
    const rows = [headersStartRow];

    records.forEach((record) => {
      const headers = Object.keys(flat(record));
      const headersRow = headers.join('\t');
      if (headersRow.length > rows[0].length) {
        rows[0] = headersRow;
      }
      const values = Object.values(flat(record));
      const valuesRow = values.join('\t').replace(/\n/gim, '\\n');
      rows.push(valuesRow);
    });

    return rows.join('\n');
  },
  [formatEnum.html]: (records) => {
    if (records.length === 0) return '';
    records.sort(() => -1);
    const headersStartRow = '';
    const rows = [headersStartRow];

    records.forEach((record) => {
      const flatRecord = flat(record);
      const headers = Object.keys(flatRecord);
      const headersRow = `<tr>${headers.map((h) => `<th style="border: 1px solid;">${h}</th>`).join('')}</tr>`;
      if (headersRow.length > rows[0].length) {
        rows[0] = headersRow;
      }
      const values = `<tr>${Object.values(flatRecord).map((v) => `<td style="border: 1px solid;">${v}</td>`).join('')}</tr>`;
      rows.push(values);
    });

    const head = rows.shift();
    return `<table style="border-collapse: collapse;"><thead>${head}</thead><tbody>${rows.join('\n')}</tbody></table>`;
  },
};

const dateRangeSchema = yup.string().test(
  'date-range',
  // eslint-disable-next-line no-template-curly-in-string
  'Date "${path}" must be in format yyyy-mm-dd and less then today',
  (value) => {
    try {
      const userDate = DateTime.fromFormat(value, 'yyyy-MM-dd');
      if (userDate.invalid) return false;
      const nowDate = DateTime.now();

      return (userDate.toSQLDate() <= nowDate.toSQLDate());
    } catch (err) {
      return false;
    }
  },
);

const toString = (data, format) => {
  const handlers = {
    [formatEnum.json]: () => JSON.stringify(data, null, 1),
    [formatEnum.tsv]: () => data,
    [formatEnum.html]: () => data,
  };
  return handlers[format]();
};

export async function controller(params) {
  const { query } = params;

  const querySchema = yup.object({
    format: yup.string().oneOf(Object.values(formatEnum)).default(formatEnum.json),
    asFile: yup.boolean().default(false),
    from: dateRangeSchema.default(DateTime.now().minus({ days: 7 }).toSQLDate()),
    to: dateRangeSchema.default(DateTime.now().toSQLDate()),
  });

  const {
    format,
    asFile,
    from,
    to,
  } = await querySchema
    .validate(query, { abortEarly: false })
    .catch((err) => {
      throw new BadRequestError(err.errors.join('\n'));
    });

  if (from > to) {
    throw new BadRequestError('Date "from" must be less then or equal date "to"');
  }

  return this.storage.events
    .read([
      { field: 'createdAt', operator: '>=', value: from },
      {
        field: 'createdAt',
        operator: '<',
        value: DateTime.fromFormat(to, 'yyyy-MM-dd').plus({ day: 1 }).toSQLDate(),
      },
    ])
    .then((incomingEvents) => this.storage.records
      .read([{
        field: 'eventId',
        operator: 'IN',
        value: incomingEvents.map(({ id }) => id),
      }])
      .then((records) => [incomingEvents, records]))
    .then(([incomingEvents, records]) => {
      const preparedRecords = [];

      incomingEvents.forEach((event) => {
        const { data: eventData, ...eventCommonFields } = event;

        eventCommonFields.meta = {
          topic: eventData.payload.object.topic,
          duration: eventData.payload.object.duration,
          host_email: eventData.payload.object.host_email,
          host_id: eventData.payload.object.host_id,
        };

        const record = records.find(({ eventId }) => eventId === event.id);
        if (record) {
          const { data: recordData, ...recordCommonFields } = record;
          recordCommonFields.meta = recordData.meta;
          preparedRecords.push({ event: eventCommonFields, record: recordCommonFields });
        } else {
          preparedRecords.push({ event: eventCommonFields });
        }
      });

      const rawData = handlerByFormat[format](preparedRecords);
      const data = asFile ? toString(rawData, format) : rawData;
      const description = `${from}_${to}`;

      return [data, asFile, format, description];
    });
}
