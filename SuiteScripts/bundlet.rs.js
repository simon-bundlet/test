/**
 * @NApiVersion 2.1
 * @NScriptType restlet
 */
define(["N/file", "N/config", "N/record", "N/search", "N/suiteAppInfo", "N/https"], (file, config, record, search, sai, https) => {
    const configTypes = [
      "userpreferences",
      "companyinformation",
      "companypreferences",
      "accountingpreferences",
      "accountingperiods",
      "manufacturingpreferences",
      "taxpreferences",
      "taxperiods",
      "companyfeatures",
      "timepost",
      "timevoid",
    ];
  
    function post(data) {
      switch (data.action) {
        case "setup": {
          const settingsFilters = data.filters || [];
          const configTypeFldMap = {};
          for (const type of configTypes.filter((configType) => settingsFilters.includes(configType))) {
            const configFldValues = {};
            try {
              const isDynamic = true;
              const configRec = config.load({ type, isDynamic });
              for (const fieldId of configRec.getFields()) {
                let fldVal, errMsg;
                try {
                  fldVal = configRec.getValue({ fieldId });
                  fldStat = configRec.getField({ fieldId });
                  if (!fldStat || !fldStat.label) {
                    continue;
                  }
                } catch (err) {
                  log.error(`${type}:${fieldId}`, err);
                  errMsg = err;
                }
                configFldValues[fieldId] = fldVal;
              }
            } catch (err) {
              log.error("failed to process config for: ", err);
            }
            configTypeFldMap[type] = configFldValues;
          }
          return JSON.stringify(configTypeFldMap);
        }
        case "file": {
          const fileId = data.fileId;
          if (fileId) {
            if (Array.isArray(fileId)) {
              const fileContents = fileId.map((id) => ({
                id,
                fileContent: file.load({ id }).getContents(),
              }));
              return { fileContents };
            }
  
            const fileObj = file.load({
              id: fileId,
            });
            const fileContent = fileObj.getContents();
            return {
              fileContent,
            };
          }
          break;
        }
        case "search": {
          const searchDef = data.searchDef;
          if (searchDef) {
            const { recordType, columns, filters = [] } = searchDef;
            const searchResults = searchPaged(recordType, filters, columns);
            return searchResults;
          }
          break;
        }
        case "workflows": {
          const workflowsMap = {};
          const allWorkflows = searchPaged("workflow", [], [{ name: "internalid", label: "id" }]);
          if (allWorkflows.length) {
            for (const { id } of allWorkflows) {
              // will run out of units if > 1000 workflows.  pagination enhancement planned.
              // this is a hack to retrieve scriptid for workflows. if you know of a better way I'd love to hear from you simon@bundlet.com
              const workflowRec = record.load({ type: "workflow", id });
              const scriptId = workflowRec.getValue({ fieldId: "scriptid" });
              if (scriptId) {
                workflowsMap[scriptId] = id;
              }
            }
          }
          return { workflowIds: workflowsMap };
        }
        case "sai": {
          return JSON.stringify(sai.listInstalledSuiteApps());
        }
        case "health": {
          return { healthy: true };
        }
        case "history": {
          const url = data.url;
          if (!url) {
            return { error: "URL not provided" };
          }
          try {
            const response = https.get({ url });
            return {
              statusCode: response.code,
              body: response.body,
              headers: response.headers
            };
          } catch (err) {
            log.error("history fetch error", err);
            return { error: err.message || String(err) };
          }
        }
        default:
          return { error: "No action specified" };
      }
    }
  
    function searchPaged(recordType, filters, columns, pageSize = 1000) {
      const searchObj = search.create({
        type: recordType,
        filters: filters,
        columns: columns,
      });
      const pagedData = searchObj.runPaged({
        pageSize: pageSize,
      });
      const searchResults = [];
  
      pagedData.pageRanges.forEach(function (pageRange) {
        const page = pagedData.fetch({ index: pageRange.index });
        page.data.forEach(function (result) {
          searchResults.push(result);
        });
      });
  
      return searchResults.map(function (result) {
        const resultObj = {};
        result.columns.forEach(function (column) {
          const label = column.label;
          resultObj[label] = result.getText(column) || result.getValue(column);
        });
        return resultObj;
      });
    }
  
    return {
      post,
    };
  });