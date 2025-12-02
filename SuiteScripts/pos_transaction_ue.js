/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/ui/serverWidget", "N/url", "N/ui/message"], function (serverWidget, url, message) {
  function beforeLoad(scriptContext) {
    const form = scriptContext.form;
    const request = scriptContext.request;

    log.debug('sss', 'sss')

    if (request && request.parameters) {
      const status = request.parameters.status;
      const msgText = request.parameters.message;

      if (status && msgText) {
        if (status === "SUCCESS") {
          form.addPageInitMessage({
            type: message.Type.CONFIRMATION,
            title: "Success",
            message: msgText,
            duration: 10000, 
          });
        } else if (status === "ERROR") {
          form.addPageInitMessage({
            type: message.Type.ERROR,
            title: "Error",
            message: msgText,
            duration: 10000, 
          });
        }
      }
    }

    
    if (scriptContext.type !== scriptContext.UserEventType.VIEW) {
      return;
    }

    const currentRecord = scriptContext.newRecord;
    const transactionStatus = currentRecord.getValue({
      fieldId: "custrecord_pos_transaction_status",
    });

    
    if (transactionStatus == 4) {
      
      const suiteletURL = url.resolveScript({
        scriptId: "customscript_pos_import_sl",
        deploymentId: "customdeploy_pos_import_sl",
        params: {
          recordId: currentRecord.id,
        },
      });

      
      form.addButton({
        id: "custpage_create_journal",
        label: "Repost Journal Entry",
        functionName: `window.open('${suiteletURL}', '_self')`,
      });
    }
  }

  return {
    beforeLoad: beforeLoad,
  };
});
