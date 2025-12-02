/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/record", "N/runtime", "N/encode", "N/query", "N/file", "./pos_jnls_lib"], function (record, runtime, encode, query, file, posJnlsLib) {
  function shouldPerformLookups() {
    const scriptObj = runtkjkljlkjkljlkjime.getCurrentScript();
    return scriptObj.getParameter({ name: "custscript_pos_enable_lookups" }) === "T";
  }

  function loadMappings() {
    const enableLookups = shouldPerformLookups();
    const mappingQuery = query.runSuiteQL({
      query: `
        SELECT 
          mapping.id,
          mapping.custrecord_pos_mappings_col_name as columnName,
          mapping.custrecord_pos_mappings_ns_field as nsField,
          mapping.custrecord_pos_mappings_lookup as lookup,
          mapping.custrecord_pos_mappings_main_line as isMainLine,
          BUILTIN.DF(mapping.custrecord_pos_mapping_field_type) as fieldType
        FROM 
          customrecord_pos_import_mapping mapping
        WHERE 
          mapping.isinactive = 'F'
      `,
    });

    const mappings = {};
    const lookupQueries = new Map();

    const mappingResults = mappingQuery.asMappedResults();
    log.debug("Loaded Mapping Configurations", {
      count: mappingResults.length,
      mappings: mappingResults,
      lookupsEnabled: enableLookups,
    });

    mappingResults.forEach((mapping) => {
      mappings[mapping.columnname.toLowerCase()] = {
        nsField: mapping.nsfield,
        lookup: enableLookups ? mapping.lookup : null,
        isMainLine: mapping.ismainline === "T",
        fieldType: mapping.fieldtype,
      };

      if (enableLookups && mapping.lookup) {
        lookupQueries.set(mapping.columnname.toLowerCase(), mapping.lookup);
      }
    });

    const lookupResults = new Map();
    if (enableLookups) {
      for (const [columnName, lookupQuery] of lookupQueries) {
        const results = query
          .runSuiteQL({
            query: lookupQuery,
          })
          .asMappedResults();
        lookupResults.set(columnName, results);
      }
    }

    log.debug("Processed Mappings", {
      mappingCount: Object.keys(mappings).length,
      lookupCount: lookupQueries.size,
      mappings: mappings,
      lookupsEnabled: enableLookups,
    });

    return { mappings, lookupResults };
  }

  function getColumnValue(rowData, columnName) {
    return rowData[columnName.toLowerCase()] || "";
  }

  function findLookupId(value, lookupData) {
    if (!value) return null;
    if (!isNaN(value) && Number.isInteger(Number(value))) {
      return Number(value);
    }

    const found = lookupData.find((item) => {
      return Object.values(item).some((fieldValue) => fieldValue === value || fieldValue === value.split(":").pop().trim());
    });

    return found ? found.id : null;
  }

  function formatValue(value, fieldType) {
    if (!value) return value;

    let formattedValue;

    switch (fieldType) {
      case "Number":
        formattedValue = parseFloat(value);
        break;
      case "Date":
        const [day, month, year] = value.split("/");
        formattedValue = `${month}/${day}/${year}`;
        break;
      case "Text":
      default:
        formattedValue = value;
    }

    return formattedValue;
  }

  function processRowData(rowData, mappings, lookupResults) {
    log.debug("Processing Row", {
      originalRow: rowData,
      availableMappings: Object.keys(mappings),
    });

    const processedData = {
      header: {},
      line: {},
    };

    for (const [columnName, mapping] of Object.entries(mappings)) {
      const value = getColumnValue(rowData, columnName);

      if (!value) {
        continue;
      }

      let processedValue = value;
      if (mapping.lookup) {
        processedValue = findLookupId(value, lookupResults.get(columnName));
        log.debug("Lookup Result", {
          column: columnName,
          originalValue: value,
          lookupResult: processedValue,
          lookupData: lookupResults.get(columnName),
        });

        if (!processedValue) {
          log.error("Lookup Failed", `Could not find matching ID for ${columnName}: ${value}`);
          continue;
        }
      } else {
        processedValue = formatValue(value, mapping.fieldType);
      }

      if (mapping.isMainLine) {
        processedData.header[mapping.nsField] = processedValue;
      } else {
        processedData.line[mapping.nsField] = processedValue;
      }
    }

    log.debug("Processed Row Result", {
      header: processedData.header,
      line: processedData.line,
    });

    return processedData;
  }

  function isBase64(str) {
    try {
      // Check if string matches base64 pattern
      return /^[A-Za-z0-9+/]*={0,2}$/.test(str) && str.length % 4 === 0;
    } catch (e) {
      return false;
    }
  }

  function validateCSV(content) {
    try {
      const rows = content.split(/\r?\n/);
      if (rows.length < 2) {
        return { isValid: false, error: "CSV must contain at least a header row and one data row" };
      }

      const headers = rows[0].split(",");
      if (!headers.length) {
        return { isValid: false, error: "No headers found in CSV" };
      }

      const headerCount = headers.length;
      for (let i = 1; i < rows.length; i++) {
        if (!rows[i].trim()) continue;
        const columns = rows[i].split(",");
        if (columns.length !== headerCount) {
          return {
            isValid: false,
            error: `Row ${i + 1} has ${columns.length} columns, expected ${headerCount}`,
          };
        }
      }

      return { isValid: true };
    } catch (e) {
      return { isValid: false, error: `CSV validation error: ${e.message}` };
    }
  }

  function getInputData() {
    try {
      log.debug("getInputData", "Starting CSV file search");

      const { mappings, lookupResults } = loadMappings();

      const folderQuery = `
SELECT 
          file.id,
          file.name
        FROM 
          file
        WHERE 
          file.folder = (SELECT folder.id FROM MediaItemFolder AS folder WHERE folder.name = 'POS Files')
          AND file.filetype = 'CSV'
          AND file.isinactive = 'F'
          AND NOT EXISTS (
            SELECT 1 
            FROM customrecord_pos_job job 
            INNER JOIN file jobfile ON job.custrecord_pos_csv_file_id = jobfile.id
            WHERE jobfile.name = file.name
          )
        ORDER BY 
          file.lastModifiedDate ASC
      `;

      const queryResults = query.runSuiteQL({
        query: folderQuery,
      });

      const fileResults = queryResults.asMappedResults();
      log.debug("File Search Results", fileResults);

      if (!fileResults || !fileResults.length) {
        throw new Error("No unprocessed CSV files found in POS Files folder");
      }

      const allTransactions = [];

      for (const fileResult of fileResults) {
        const fileId = fileResult.id;
        const fileName = fileResult.name;
        let jobRecordId;

        log.debug("Processing File", { id: fileId, name: fileResult.name });

        const jobRecord = record.create({
          type: "customrecord_pos_job",
          isDynamic: true,
        });

        jobRecord.setValue({
          fieldId: "custrecord_pos_job_status",
          value: 2,
        });

        jobRecord.setValue({
          fieldId: "custrecord_pos_csv_file",
          value: fileId,
        });

        jobRecord.setValue({
          fieldId: "custrecord_pos_csv_file_id",
          value: fileId,
        });

        jobRecord.setValue({
          fieldId: "custrecord_pos_csv_file_name",
          value: fileName,
        });

        try {
          const csvFile = file.load({ id: fileId });
          let csvContent = csvFile.getContents();

          if (isBase64(csvContent)) {
            log.debug("Detected Base64 encoded content", { fileId });
            csvContent = encode.convert({
              string: csvContent,
              inputEncoding: encode.Encoding.BASE_64,
              outputEncoding: encode.Encoding.UTF_8,
            });
          }

          const validation = validateCSV(csvContent);
          if (!validation.isValid) {
            log.error("Invalid CSV file", {
              fileId,
              fileName,
              error: validation.error,
            });

            jobRecord.setValue({
              fieldId: "custrecord_pos_job_status",
              value: 4, // Error
            });

            jobRecord.setValue({
              fieldId: "custrecord_pos_error",
              value: `Invalid CSV format: ${validation.error}`,
            });

            jobRecord.save();
            continue; // Skip to next file
          }

          const rows = csvContent.split(/\r?\n/);
          const headers = rows[0].split(",").map((header) => header.trim().toLowerCase());
          const transactionMap = new Map();

          jobRecordId = jobRecord.save();

          for (let i = 1; i < rows.length; i++) {
            if (!rows[i] || rows[i].trim() === "") {
              log.debug("Skipping Empty Row", { rowNumber: i });
              continue;
            }

            const values = rows[i].split(",").map((value) => value.trim());
            if (values.every((val) => !val)) {
              log.debug("Skipping Row with all empty values", { rowNumber: i });
              continue;
            }

            const rowData = {};
            headers.forEach((header, index) => {
              rowData[header] = values[index] || "";
            });

            const processedData = processRowData(rowData, mappings, lookupResults);
            const tranId = processedData.header.tranid;

            if (!tranId) {
              log.debug("Skipping Row without tranId", { rowNumber: i });
              continue;
            }

            if (!transactionMap.has(tranId)) {
              transactionMap.set(tranId, {
                header: processedData.header,
                lines: [],
                jobRecordId: jobRecordId,
                fileId: fileId,
              });
            }

            if (Object.keys(processedData.line).length > 0) {
              transactionMap.get(tranId).lines.push(processedData.line);
            }
          }

          const fileTransactions = Array.from(transactionMap.values());
          allTransactions.push(...fileTransactions);
        } catch (fileError) {
          log.error("File Processing Error", {
            fileId,
            fileName,
            error: fileError.message,
          });

          jobRecord.setValue({
            fieldId: "custrecord_pos_job_status",
            value: 4, // Error
          });

          jobRecord.setValue({
            fieldId: "custrecord_pos_error",
            value: fileError.message,
          });

          jobRecord.save();
        }
      }

      log.debug("All Transactions", { count: allTransactions.length });
      return allTransactions;
    } catch (err) {
      log.error("getInputData Error", err);
      throw err;
    }
  }

  function map(context) {
    const transactionData = JSON.parse(context.value);
    const jobRecordId = transactionData.jobRecordId;

    log.debug("Starting Map", {
      jobRecordId: jobRecordId,
      transactionData: transactionData,
    });

    try {
      const childRecordShell = record.create({
        type: "customrecord_pos_transaction",
        isDynamic: true,
      });

      childRecordShell.setValue({
        fieldId: "custrecord_pos_job",
        value: jobRecordId,
      });

      childRecordShell.setValue({
        fieldId: "custrecord_pos_transaction_status",
        value: 2,
      });

      childRecordShell.setValue({
        fieldId: "custrecord_pos_transaction_data",
        value: JSON.stringify(transactionData, null, 2),
      });

      const childRecordShellId = childRecordShell.save()

      const childRecord = record.load({
        type: "customrecord_pos_transaction",
        id: childRecordShellId,
        isDynamic: true,
      });

      try {
        const journalResult = posJnlsLib.createJournalEntry({
          transactionData: transactionData,
        }, childRecord.id);

        if (journalResult.success) {
          childRecord.setValue({
            fieldId: "custrecord_pos_created",
            value: journalResult.journalId,
          });

          childRecord.setValue({
            fieldId: "custrecord_pos_transaction_status",
            value: 3,
          });
        } else {
          childRecord.setValue({
            fieldId: "custrecord_pos_transaction_status",
            value: 4,
          });

          childRecord.setValue({
            fieldId: "custrecord_pos_error",
            value: journalResult.error,
          });
        }
      } catch (journalError) {
        log.error("Journal Creation Error", {
          error: journalError.message,
          data: transactionData,
        });

        childRecord.setValue({
          fieldId: "custrecord_pos_transaction_status",
          value: 4,
        });

        childRecord.setValue({
          fieldId: "custrecord_pos_error",
          value: journalError.message,
        });
      }

      const childRecordId = childRecord.save();

      context.write({
        key: jobRecordId,
        value: childRecordId,
      });
    } catch (err) {
      log.error("Map Error", err);
      context.write({
        key: jobRecordId,
        value: null,
      });
      throw err;
    }
  }

  function summarize(summary) {
    try {
      log.debug("Summarize Start", "Beginning summarize phase");

      const jobsToUpdate = {};

      summary.mapSummary.errors.iterator().each(function (key, error) {
        errorCount++;
        log.error("Map Error for key: " + key, error);
        return true;
      });

      summary.output.iterator().each(function (key, value) {
        log.debug("Summarize Output", {
          jobId: key,
          value: value,
        });

        jobsToUpdate[key] = true;
        return true;
      });

      for (const jobId in jobsToUpdate) {
        log.audit("Processing Summary for Job", {
          jobId: jobId,
        });

        record.submitFields({
          type: "customrecord_pos_job",
          id: jobId,
          values: {
            custrecord_pos_job_status: 3,
          },
        });
      }

      log.debug("Summarize Complete", {
        totalJobs: Object.keys(jobsToUpdate).length,
      });
    } catch (err) {
      log.error("Summarize Error", err);
      throw err;
    }
  }

  return {
    getInputData: getInputData,
    map: map,
    summarize: summarize,
  };
});