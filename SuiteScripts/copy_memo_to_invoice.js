/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
 */

define(['N/record', 'N/search'], function (record, search) {
    function beforeSubmit(context) {
        var cur = context.newRecord;

        // Waarde ophalen van het memo-veld op header-niveau
        var memo = cur.getValue({
            fieldId: "memo"
        });

        // Waarde ophalen van de checkbox
        var check = cur.getValue({
            fieldId: "custbody_ret_copy_memo_lines"
        });

        // Controleer het aantal regels in de 'item' sublijst
        var itemcount = cur.getLineCount({ sublistId: 'item' });
        log.debug({
            title: 'item count',
            details: itemcount
        });

        // Als de checkbox is aangevinkt, kopieer het memo naar de regels
        if (check == true && memo) {
            for (var k = 0; (itemcount >= 0) && (k < itemcount); k++) {
                // Zet het memo op de description van de regel
                cur.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'description',
                    line: k,
                    value: memo
                });
            }
        }
    }

    return {
        beforeSubmit: beforeSubmit
    };
});
