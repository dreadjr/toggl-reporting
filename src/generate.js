#!/usr/bin/env node

'use strict'

var argv = require('yargs')
  .usage('Usage: $0 <command> [options]')
  .command('report', 'Export detailed report')
  .demand(1)
  .example('$0 report [-t apiToken] -w {workspace_id} -s {2016-07-01} -e {2016-07-02}')
  .demand(['w'])
  .alias('w', 'workspace_id')
  .alias('s', 'start')
  .alias('e', 'end')
  .alias('t', 'apiToken')
  .argv;

require('dotenv').config();

let os = require("os");
let BlueBird = require('bluebird');
let Lodash = require('lodash');
let debug = require('debug')('toggle-reporting');
let TogglClient = require('toggl-api');
let Readable = require('stream').Readable;
// co-prompt

let options = {
  apiToken: process.env.TOGGL_API_TOKEN
};

let toggl = new TogglClient(options);

let reportOptions = {
  workspace_id: argv.workspace_id,
  since: argv.start,
  until: argv.end,
  page: 1
};

let detailedReportAllPages = BlueBird.coroutine(pagedGet);

detailedReportAllPages(reportOptions, toggl)
  .then(function(data) {
    debug('retrieved data', data.length);
//    debug(JSON.stringify(data));
    debug('exporting into csv');
    return data;
  })
  .then(function(data) {
    // TODO: streaming write/read

    let json = JSON.stringify(data);

    if (argv.f) {
      // save to file
    } else {

      let rs = new Readable;
      rs.push(json);
      rs.push(null);

      rs.pipe(process.stdout);
    }
  })
  .catch(function(err) {
    console.log('ERROR', err);
  });

function* pagedGet(opts, context) {
  var self = context || this;

  let currentPage = 1;
  let finalResponse;
  let setMeta = false;

  do {
    let options = Object.assign(opts, {
      page: currentPage
    });

    debug('START REQ', options);
    let get = BlueBird.promisify(self.detailedReport, { context: self });
    let resp = yield get(options);
    debug('END REQ', options);

    if (!setMeta) {
      finalResponse = Lodash.omit(resp, ['data']);
      finalResponse.data = [];
      finalResponse.params = opts;
    }

    var newData = resp.data;
    finalResponse.data = finalResponse.data.concat(newData);

    if (resp.data.length < resp.per_page) {
      currentPage = 0;
    } else {
      currentPage++;
    }
  } while ( currentPage > 0 );

  return finalResponse;
}
