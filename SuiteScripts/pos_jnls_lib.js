/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(["N/record", "N/log"], function (record, log) {
  /**
   * Creates a Journal Entry from transaction data
   *
   * @param {Object} params Parameters object
   * @param {Object} params.transactionData The transaction data containing header and lines
   * @returns {Object} Result object with success, journalId, and error properties
   */
  function createJournalEntry(params, posTransactionId) {
    const transactionData = params.transactionData;

    log.debug("Creating JE", {
      transactionData: transactionData,
    });

    const result = {
      success: false,
      journalId: null,
      error: null,
    };

    try {
      const journalEntry = record.create({
        type: record.Type.JOURNAL_ENTRY,
        isDynamic: true,
      });

      log.debug("Setting Header Fields", transactionData.header);

      if (transactionData.header.subsidiary) {
        log.debug("Setting Subsidiary First", {
          value: transactionData.header.subsidiary,
        });

        journalEntry.setValue({
          fieldId: "subsidiary",
          value: transactionData.header.subsidiary,
        });
      }

      // create link to POS transaction
      if (posTransactionId)
      journalEntry.setValue({
        fieldId: "custbody_pos_transaction_id",
        value: posTransactionId
      })

      for (const [fieldId, value] of Object.entries(transactionData.header)) {
        if (fieldId === "subsidiary") continue;

        log.debug("Setting Header Field", {
          fieldId: fieldId,
          value: value,
          valueType: typeof value,
        });

        journalEntry.setValue({
          fieldId: fieldId,
          value: fieldId === "trandate" ? new Date(value) : value,
        });
      }

      journalEntry.setValue({
        fieldId: "custbody_ret_copy_memo_lines",
        value: false,
      });

      // Set line fields in the specified order
      transactionData.lines.forEach((line, index) => {
        log.debug(`Setting Line ${index + 1}`, line);

        journalEntry.selectNewLine({ sublistId: "line" });

        const fieldOrder = ["account", "debit", "credit", "taxcode", "memo", "department", "class", "tax1amt", "tax1acct"];

        fieldOrder.forEach((fieldId) => {
          if (line[fieldId] != null) {

            journalEntry.setCurrentSublistValue({
              sublistId: "line",
              fieldId,
              value: line[fieldId],
            });
          }
        });

        journalEntry.commitLine({ sublistId: "line" });
      });

      // Log totals before saving
      let totalDebit = 0,
        totalCredit = 0,
        totalTax = 0;
      const lineCount = journalEntry.getLineCount({ sublistId: "line" });

      for (let i = 0; i < lineCount; i++) {
        totalDebit +=
          +journalEntry.getSublistValue({
            sublistId: "line",
            fieldId: "debit",
            line: i,
          }) || 0;
        totalCredit +=
          +journalEntry.getSublistValue({
            sublistId: "line",
            fieldId: "credit",
            line: i,
          }) || 0;
        totalTax +=
          +journalEntry.getSublistValue({
            sublistId: "line",
            fieldId: "tax1amt",
            line: i,
          }) || 0;
      }

      log.debug("Line Totals", {
        totalDebit,
        totalCredit,
        totalTax,
      });

      const journalId = journalEntry.save();
      log.audit("Journal Entry Created", {
        journalId,
        tranId: transactionData.header.tranid,
        lineCount: transactionData.lines.length,
      });

      result.success = true;
      result.journalId = journalId;
    } catch (error) {
      log.error("Journal Creation Error", {
        error: error.message,
        data: transactionData,
      });

      result.error = error.message;
    }

    return result;
  }

  /**
   * Creates a Cash Sale from transaction data
   *
   * @param {Object} params Parameters object
   * @param {Object} params.transactionData The transaction data containing header and lines
   * @param {number} posTransactionId The POS transaction record ID
   * @returns {Object} Result object with success, cashSaleId, and error properties
   */
  function createCashSale(params, posTransactionId) {
    const transactionData = params.transactionData;

    log.debug("Creating Cash Sale", {
      transactionData: transactionData,
    });

    const result = {
      success: false,
      cashSaleId: null,
      error: null,
    };

    try {
      const cashSale = record.create({
        type: record.Type.CASH_SALE,
        isDynamic: true,
      });

      log.debug("Setting Cash Sale Header Fields", transactionData.header);

      // Set form first (hardcoded to 140 for Cash Sale)
      cashSale.setValue({
        fieldId: "customform",
        value: 140,
      });
      
      // Set entity (customer) early
      if (transactionData.header.entity) {
        log.debug("Setting Entity (Customer)", {
          value: transactionData.header.entity,
        });
        cashSale.setValue({
          fieldId: "entity",
          value: transactionData.header.entity,
        });
      }

      // Set subsidiary first (required)
      if (transactionData.header.subsidiary) {
        log.debug("Setting Subsidiary", {
          value: transactionData.header.subsidiary,
        });
        cashSale.setValue({
          fieldId: "subsidiary",
          value: transactionData.header.subsidiary,
        });
      }

      // Set other header fields
      for (const [fieldId, value] of Object.entries(transactionData.header)) {
        if (fieldId === "subsidiary" || fieldId === "entity") continue;

        log.debug("Setting Header Field", {
          fieldId: fieldId,
          value: value,
          valueType: typeof value,
        });

        cashSale.setValue({
          fieldId: fieldId,
          value: fieldId === "trandate" ? new Date(value) : value,
        });
      }

      // Set Create Check to false
      cashSale.setValue({
        fieldId: "createfrom",
        value: false,
      });

      // Create link to POS transaction
      if (posTransactionId) {
        cashSale.setValue({
          fieldId: "custbody_pos_transaction_id",
          value: posTransactionId,
        });
      }

      // Add line items
      transactionData.lines.forEach((line, index) => {
        log.debug(`Setting Cash Sale Line ${index + 1}`, line);

        cashSale.selectNewLine({ sublistId: "item" });

        // Set fields in specified order
        const fieldOrder = [
          "item",
          "quantity",
          "rate",
          "custcol_ret_pos_gst_amt",
          "custcol_ret_pos_pst_amt",
          "custcol_ret_outlet_store_name",
          "department",
          "class",
          "custcol_ret_pos_employee_code",
        ];

        fieldOrder.forEach((fieldId) => {
          if (line[fieldId] != null && line[fieldId] !== "") {

            cashSale.setCurrentSublistValue({
              sublistId: "item",
              fieldId,
              value: line[fieldId],
            });
          }
        });

        cashSale.commitLine({ sublistId: "item" });
      });

      // Log totals before saving
      const lineCount = cashSale.getLineCount({ sublistId: "item" });
      let totalAmount = 0;

      for (let i = 0; i < lineCount; i++) {
        const amount =
          +cashSale.getSublistValue({
            sublistId: "item",
            fieldId: "amount",
            line: i,
          }) || 0;
        totalAmount += amount;
      }

      log.debug("Cash Sale Totals", {
        lineCount,
        totalAmount,
      });

      const cashSaleId = cashSale.save();
      log.audit("Cash Sale Created", {
        cashSaleId,
        lineCount: transactionData.lines.length,
        totalAmount,
      });

      result.success = true;
      result.cashSaleId = cashSaleId;
    } catch (error) {
      log.error("Cash Sale Creation Error", {
        error: error.message,
        stack: error.stack,
        data: transactionData,
      });

      result.error = error.message;
    }

    return result;
  }

  /**
   * Creates a Cash Refund from transaction data
   *
   * @param {Object} params Parameters object
   * @param {Object} params.transactionData The transaction data containing header and lines
   * @param {number} posTransactionId The POS transaction record ID
   * @returns {Object} Result object with success, cashRefundId, and error properties
   */
  function createCashRefund(params, posTransactionId) {
    const transactionData = params.transactionData;

    log.debug("Creating Cash Refund", {
      transactionData: transactionData,
    });

    const result = {
      success: false,
      cashRefundId: null,
      error: null,
    };

    try {
      const cashRefund = record.create({
        type: record.Type.CASH_REFUND,
        isDynamic: true,
      });

      log.debug("Setting Cash Refund Header Fields", transactionData.header);

      // Set form first (hardcoded to 141 for Cash Refund)
      cashRefund.setValue({
        fieldId: "customform",
        value: 141,
      });

      // Set subsidiary first (required)
      if (transactionData.header.subsidiary) {
        log.debug("Setting Subsidiary", {
          value: transactionData.header.subsidiary,
        });
        cashRefund.setValue({
          fieldId: "subsidiary",
          value: transactionData.header.subsidiary,
        });
      }

      // Set entity (customer) early
      if (transactionData.header.entity) {
        log.debug("Setting Entity (Customer)", {
          value: transactionData.header.entity,
        });
        cashRefund.setValue({
          fieldId: "entity",
          value: transactionData.header.entity,
        });
      }

      // Set other header fields
      for (const [fieldId, value] of Object.entries(transactionData.header)) {
        if (fieldId === "subsidiary" || fieldId === "entity") continue;

        log.debug("Setting Header Field", {
          fieldId: fieldId,
          value: value,
          valueType: typeof value,
        });

        cashRefund.setValue({
          fieldId: fieldId,
          value: fieldId === "trandate" ? new Date(value) : value,
        });
      }

      // Set Create Check to false
      cashRefund.setValue({
        fieldId: "createfrom",
        value: false,
      });

      // Create link to POS transaction
      if (posTransactionId) {
        cashRefund.setValue({
          fieldId: "custbody_pos_transaction_id",
          value: posTransactionId,
        });
      }

      // Add line items (amounts should already be positive)
      transactionData.lines.forEach((line, index) => {
        log.debug(`Setting Cash Refund Line ${index + 1}`, line);

        cashRefund.selectNewLine({ sublistId: "item" });

        // Set fields in specified order
        const fieldOrder = [
          "item",
          "quantity",
          "rate",
          "custcol_ret_pos_gst_amt",
          "custcol_ret_pos_pst_amt",
          "custcol_ret_outlet_store_name",
          "department",
          "class",
          "custcol_ret_pos_employee_code",
        ];

        fieldOrder.forEach((fieldId) => {
          if (line[fieldId] != null && line[fieldId] !== "") {

            cashRefund.setCurrentSublistValue({
              sublistId: "item",
              fieldId,
              value: line[fieldId],
            });
          }
        });

        cashRefund.commitLine({ sublistId: "item" });
      });

      // Log totals before saving
      const lineCount = cashRefund.getLineCount({ sublistId: "item" });
      let totalAmount = 0;

      for (let i = 0; i < lineCount; i++) {
        const amount =
          +cashRefund.getSublistValue({
            sublistId: "item",
            fieldId: "amount",
            line: i,
          }) || 0;
        totalAmount += amount;
      }

      log.debug("Cash Refund Totals", {
        lineCount,
        totalAmount,
      });

      const cashRefundId = cashRefund.save();
      log.audit("Cash Refund Created", {
        cashRefundId,
        lineCount: transactionData.lines.length,
        totalAmount,
      });

      result.success = true;
      result.cashRefundId = cashRefundId;
    } catch (error) {
      log.error("Cash Refund Creation Error", {
        error: error.message,
        stack: error.stack,
        data: transactionData,
      });

      result.error = error.message;
    }

    return result;
  }

  return {
    createJournalEntry: createJournalEntry,
    createCashSale: createCashSale,
    createCashRefund: createCashRefund,
  };
});
