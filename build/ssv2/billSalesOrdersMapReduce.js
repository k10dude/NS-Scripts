/**
 * billSalesOrdersMapReduce.ts
 *
 * @NScriptName Bill Sales Orders - Map/Reduce
 * @NScriptType MapReduceScript
 * @NApiVersion 2.x
 */
define(["N/email", "N/log", "N/record", "N/render", "N/runtime", "N/search"], 

function (email, log, record, render, runtime, search) {
    var exports = {};
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getInputData = function () {
        // Find sales orders to bill
        var orderIds = [];
        var searchId = runtime.getCurrentScript().getParameter({ name: 'custscript_bill_orders_search' });
        log.debug('getInputData', "Running saved search: " + searchId + ".");
        search.load({ id: searchId }).run().each(function (result) {
            orderIds.push(result.id);
            return true;
        });
        return orderIds;
    };
    exports.map = function (context) {
        try {
            // Create an invoice / cash sale for the sales order passed in
            var salesOrderInternalId = Number(context.value);
            log.debug('map', "Processing order " + salesOrderInternalId + " at " + new Date() + ".");
            // Some sales orders need to get billed as cash sales, while others will be billed as invoices.  Try cash sale first.
            var billingTransaction = void 0;
            try {
                log.debug('map', "Trying cash sale for order id " + salesOrderInternalId + ".");
                billingTransaction = record.transform({ fromType: 'salesorder', fromId: salesOrderInternalId, toType: 'cashsale' });
            }
            catch (e) { // If that failed, it means it needs to be billed as an invoice
                log.debug('map', "Creating invoice for order id " + salesOrderInternalId + ".");
                billingTransaction = record.transform({ fromType: 'salesorder', fromId: salesOrderInternalId, toType: 'invoice' });
            }
            var customerId = billingTransaction.getValue('entity'); // We write out values by customer so we can email the customer in the reduce phase.
            var billingTransactionId = billingTransaction.save({ ignoreMandatoryFields: true });
            log.audit('map', "Created transaction " + billingTransactionId + " for SO " + salesOrderInternalId + " at " + new Date() + ".");
            context.write(customerId, String(billingTransactionId));
        }
        catch (e) {
            log.error('map', e.message);
        }
    };
    exports.reduce = function (context) {
        try { // For each customer we created invoices for, send them an email with PDF printouts of each invoice attached.
            log.debug('reduce', context.values);
            var customerId = context.key;
            var templateId = Number(runtime.getCurrentScript().getParameter({ name: 'custscript_bill_orders_template' }));
            var renderer = render.mergeEmail({ entity: { type: 'customer', id: Number(customerId) }, templateId: templateId });
            var attachments = [];
            for (var i = 0; i < context.values.length; i++) {
                var billingTransactionId = Number(context.values[i]);
                log.debug('reduce', "Creating PDF for transaction " + billingTransactionId + ".");
                var pdf = render.transaction({ entityId: billingTransactionId, printMode: render.PrintMode.PDF });
                attachments.push(pdf);
            }
            email.send({ author: 21, recipients: [customerId], subject: renderer.subject, body: renderer.body, attachments: attachments });
        }
        catch (e) {
            log.error('reduce', e.message);
        }
    };
    exports.summarize = function (context) {
        log.debug('Summarize', 'Execution Complete');
    };
    return exports;
});
