/**
 * billSalesOrdersMapReduce.ts
 *
 * @NScriptName Bill Sales Orders - Map/Reduce
 * @NScriptType MapReduceScript
 * @NApiVersion 2.x
 */

import {EntryPoints} from 'N/types';
import email = require('N/email');
import file = require('N/file');
import log = require('N/log');
import record = require('N/record');
import render = require('N/render');
import runtime = require('N/runtime');
import search = require('N/search');

export const getInputData: EntryPoints.MapReduce.getInputData = () => { // Gets 10,000 usage points
  // Find sales orders to bill
  const orderIds: string[] = [];
  const searchId = runtime.getCurrentScript().getParameter({ name: 'custscript_bill_orders_search' }) as string;
  log.debug('getInputData', `Running saved search: ${searchId}.`);
  search.load({ id: searchId }).run().each((result) => { // Handles up to 4000 results
    orderIds.push(result.id);
    return true;
  });
  return orderIds;
};

export const map: EntryPoints.MapReduce.map = (context) => { // Map gets 1,000 usage points
  try {
    // Create an invoice / cash sale for the sales order passed in
    const salesOrderInternalId = Number(context.value);
    log.debug('map', `Processing order ${salesOrderInternalId} at ${new Date()}.`);
    // Some sales orders need to get billed as cash sales, while others will be billed as invoices.  Try cash sale first.
    let billingTransaction: record.Record;
    try {
      log.debug('map', `Trying cash sale for order id ${salesOrderInternalId}.`);
      billingTransaction = record.transform({ fromType: 'salesorder', fromId: salesOrderInternalId, toType: 'cashsale' });
    } catch(e) { // If that failed, it means it needs to be billed as an invoice
      log.debug('map', `Creating invoice for order id ${salesOrderInternalId}.`);
      billingTransaction = record.transform({ fromType: 'salesorder', fromId: salesOrderInternalId, toType: 'invoice' });
    }
    const customerId = billingTransaction.getValue('entity') as string; // We write out values by customer so we can email the customer in the reduce phase.
    const billingTransactionId = billingTransaction.save({ ignoreMandatoryFields: true });
    log.audit('map', `Created transaction ${billingTransactionId} for SO ${salesOrderInternalId} at ${new Date()}.`);
    context.write(customerId, String(billingTransactionId));
  } catch(e) {
    log.error('map', e.message);
  }
};

export const reduce: EntryPoints.MapReduce.reduce = (context) => { // Reduce gets 5,000 governance points
  try { // For each customer we created invoices for, send them an email with PDF printouts of each invoice attached.
    log.debug('reduce', context.values);
    const customerId = context.key;
    const templateId = Number(runtime.getCurrentScript().getParameter({ name: 'custscript_bill_orders_template' }));
    const renderer = render.mergeEmail({ entity: { type: 'customer', id: Number(customerId) }, templateId });
    const attachments: file.File[] = [];

    for (let i = 0; i < context.values.length; i++) {
      const billingTransactionId = Number(context.values[i]);
      log.debug('reduce', `Creating PDF for transaction ${billingTransactionId}.`);
      const pdf = render.transaction({ entityId: billingTransactionId, printMode: render.PrintMode.PDF });
      attachments.push(pdf);
    }

    email.send({ author: 21, recipients: [customerId], subject: renderer.subject, body: renderer.body, attachments });
  } catch(e) {
    log.error('reduce', e.message);
  }
};

export const summarize: EntryPoints.MapReduce.summarize = (context) => { // Gets 10,000 usage points
  log.debug('Summarize', 'Execution Complete');
};
