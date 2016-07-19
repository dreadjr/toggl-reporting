#!/usr/bin/env node

'use strict';

require('dotenv').config();

var argv = require('yargs')
  .usage('Usage: $0 <command> [options]')
  .command('output', 'Produce csv')
  .demand(1)

  .example('$0 output')
  .demand([])

  .options({
    'f': {
      alias: 'format',
      default: 'csv'
    },
    'r': {
      alias: 'rate',
      default: Number(process.env.BILLING_RATE) || 125,
      type: 'number'
    },
    'df': {
      alias: 'dateformat',
      default: process.env.DATE_FORMAT || "YYYY-MM-DDTHH:mm:ssZ",
    },
    'm': {
      alias: 'minduration',
      default: Number(process.env.MIN_BILLING_DURATION) || 15 * 60 * 1000,
      type: 'number'
    },
    'p': {
      alias: 'filepostfix',
      default: process.env.FILE_POSTFIX || "",
    },
  })

  .argv;

let debug = require('debug')('processor');
let Lodash = require('lodash');
let moment = require('moment');
require("moment-duration-format");

let Rx = require('rx');
let RxNode = require('rx-node');
let fs = require('fs');

let json2csv = require('json2csv');

function *timeChunks(start, end, interval, period) {
  if (!interval) interval = 1;
  if (!period) period = 'day';

  let currentStart = start, currentStartEod, currentEnd;
  let total = 0;

  do {
    currentStartEod = currentStart.clone().add(interval, period).startOf(period);
    currentEnd = moment.min(currentStartEod, end);

    let range = {
      start: currentStart,
      end: currentEnd,
      duration: currentEnd.diff(currentStart)
    };

    yield range;
    currentStart.add(interval, period).startOf(period);
  } while (currentEnd.isBefore(end));
}

let subscription = RxNode
  .fromReadableStream(process.stdin)
  .subscribe(function (x) {
    let json = JSON.parse(x);

    let data = json.data;
    var allEntries = Lodash
      .flatMap(data, function(entry) {
        let start = moment(entry.start);
        let end = moment(entry.end);

        var entries = [];
        for (var v of timeChunks(start, end, 1, 'day')) {
          // TODO: round to nearest start of minute???
          let start_billable = v.start.startOf('minute');
          let end_billable = v.end.startOf('minute');
          let dur_billable = end_billable.diff(start_billable);

          debug(`adding billable rounded=${dur_billable} calc=${v.duration}, min=${argv.minduration}`);

          // incremental billing min + round up to nearest minute
          v.dur_billable = Math.max(argv.minduration, dur_billable);

          let e = Lodash.assign(Lodash.cloneDeep(entry), {
            dur_billable: v.dur_billable,
            start_billable: start_billable.format(argv.dateformat),
            end_billable: end_billable.format(argv.dateformat)
          });
          entries.push(e)
        }

        return entries;
      });

  var fields = [
    {
      label: 'Date',
      value: function(row) {
        return Lodash.isEmpty(row.start_billable) ? "" : moment(row.start_billable).format("YYYY-MM-DD");
      }
    },
    {
      label: 'Description',
      value: 'description'
    },
    {
      label: 'Start time',
      value: function(row) {
        return Lodash.isEmpty(row.start_billable) ? "" : moment(row.start_billable).format("HH:mm:ss");
      }
    },
    {
      label: 'End time',
      value: function(row) {
        return Lodash.isEmpty(row.end_billable) ? "" : moment(row.end_billable).format("HH:mm:ss");
      }
    },
    {
      label: 'Total time',
      value: function(row) {
        //      return moment.duration(row.dur_billable).format()
        return moment.duration(row.dur_billable).format("HH:mm:ss", { trim: false })
      }
    },
    {
      label: 'Total',
      value: function(row) {
        let hours = moment.duration(row.dur_billable).asHours();
        let total = hours * argv.rate;
        return row._totalrow ? Math.floor(total) : total;
      }
    },
  ];

  Lodash(allEntries)
    .groupBy(function(e) {
      return moment(e.start_billable).startOf('week').isoWeekday(6).format(argv.dateformat);
    })
    .each(function(gEntries, k) {
      let sow = moment(k);
      let eow = sow.clone().add(6, 'day').endOf('day');

      var total_billable = Lodash.sumBy(gEntries, function(e) {
        return e.dur_billable;
      });

      // MARK: add total line
      gEntries.push({
        _totalrow: true,
        dur_billable: total_billable
      });

      // MARK: convert to csv
      try {
        var result = json2csv({ data: gEntries, fields: fields });

        let file = `${sow.format("YYYYMMDD")}-${eow.format("YYYYMMDD")}${argv.filepostfix}.csv`;
        fs.writeFile(file, result, function(err) {
        if (err) throw err;
          console.log(`${file} saved`);
        });
      } catch (err) {
        console.error(err);
      }
    });

  //single
  let allMinDates = Lodash.map(allEntries, function(e) {
    return moment(e.start_billable).startOf('week').isoWeekday(6);
  });
  let allMaxDates = Lodash.map(allEntries, function(e) {
    return moment(e.start_billable).startOf('week').isoWeekday(6).add(6, 'day').endOf('day');
  });
  let
    max = moment.max(allMaxDates),
    min = moment.min(allMinDates);

  var total_billable = Lodash.sumBy(allEntries, function(e) {
    return e.dur_billable;
  });

  // MARK: add total line
  allEntries.push({
    _totalrow: true,
    dur_billable: total_billable
  });

  // MARK: convert to csv
  try {
    var result = json2csv({ data: allEntries, fields: fields });
    let file = `${min.format("YYYYMMDD")}-${max.format("YYYYMMDD")}${argv.filepostfix}.csv`;
    fs.writeFile(file, result, function(err) {
    if (err) throw err;
      console.log(`${file} saved`);
    });
  } catch (err) {
    console.error(err);
  }

}, function(err) {
  console.log('error', err);
});
