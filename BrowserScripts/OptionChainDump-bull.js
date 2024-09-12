setTimeout(myCallback, 5000);
var runonce = 1;
const index = 'optionchain';
var propertyNamesToMonitor = [];
var currentArray, previousArray;
var expiry = new Date();
var symbol = '';
var cacheKey = '';
const propertyNamesToCheckForChange = ['OIChg', 'call_OI', 'put_OI'];

function myCallback(a, b) {
	try
	{
	let expiryDateStr = getQueryStringParameterByName('expiry');
	expiry = (new Date(expiryDateStr)).toISOString();
	symbol = document.querySelector('.instrument-symbol').innerText;
	cacheKey = `${index}-${expiry}-${symbol}`;
	previousArray = JSON.parse(localStorage.getItem(cacheKey));
	var currentTimeIst = getISTISOString();
	if (runonce === 1) {
		removeElem('.sc-jZthWk tr:first-child');
	}
	var currentArray = extractTable('sc-gOjUcv');

	if (
		havePropertiesChanged(currentArray, previousArray, propertyNamesToMonitor)
	) {
		bulkInsertToElasticsearch(index, currentArray, currentTimeIst);
		previousArray = Array.from(currentArray);
		localStorage.setItem(cacheKey, JSON.stringify(previousArray));
	}

	runonce++;
	}
	catch(ex)
	{
		console.log(ex)
	}
	finally
	{
		setTimeout(myCallback, 5000);
	}
}

function removeElem(className) {
	let d1 = document.querySelector(className);

	if (d1) d1.remove();
}

function extractTable(className) {
    let table = document.getElementsByClassName(className)[0];

    if (table) {
        var header = [];
        var rows = [];
        var indexOfStrike = -1;

        // Find the index of the 'Strike' column
        for (var a = 0; a < table.rows[0].cells.length; a++) {
            if (table.rows[0].cells[a].innerText.replace(/[^a-zA-Z\+\-\%]/g, '') === 'Strike') {
                indexOfStrike = a;
                break;
            }
        }

        // Generate headers
        for (var i = 0; i < table.rows[0].cells.length; i++) {
            let initial = i === indexOfStrike ? '' : (i < indexOfStrike) ? 'call_' : 'put_';
            let hdrName = initial + table.rows[0].cells[i].innerText.replace(/[^a-zA-Z\+\-\%]/g, '').replace('-lakhCallOI','').replace('-lakhPutOI','');
            header.push(hdrName);
            
            if (runonce === 1 && propertyNamesToCheckForChange.some((substring) => hdrName.includes(substring)))
							propertyNamesToMonitor.push(hdrName);
        }

        // Extract rows
        for (var i = 1; i < table.rows.length; i++) {
            var row = {};
            for (var j = 0; j < table.rows[i].cells.length; j++) {
                let stringValue = table.rows[i].cells[j].innerText.replace(/[^0-9.\+\-\%]/g, '');
                let parsedVal = parseToFloat(stringValue, header[j])
                row[header[j]] = parsedVal;
            }
            row.call_LTPChg = 0;
            row.put_LTPChg = 0;
            rows.push(row);
        }
        return rows;
    }
    return [];
}


function parseToFloat(input, hdrName) {
	var output = input;
	if(hdrName && hdrName.includes('Strike'))
	{
		output = parseFloat(input);
	}
	else
	{
	  if (typeof input === 'string') {
      let parsed = parseFloat(input);
      if (!isNaN(parsed)) {
      		output = stringToFloatConverter(input);
      }
	  } 
	  else if (typeof input === 'number') {
      input = input.toString();
      output = stringToFloatConverter(input);
  	 }
	}
  return output;
}

function stringToFloatConverter(input)
{
	let parsed = 0;
	let parts = input.split('.');
	if(parts.length === 1)
  {
  		input = parts[0] + '.001';
  }
  else
  {
  	  input = parts[0] + '.' + parts[1].substring(0, 2) + (parts[1].length === 2 ? '1' : '01');
  }
  return parseFloat(input);
}

function havePropertiesChanged(currentArray, previousArray, propertyNames) {
	if (!previousArray) {
		return true;
	}
	var strikesChanged = 0;
	for (let i = 0; i < currentArray.length; i++) {
		var isPropertyChanged = false;
		const currentObj = currentArray[i];
		
		const previousObj = previousArray.find(obj => obj.Strike === currentObj.Strike);

		if (!previousObj)
			continue;
			
		for (const propertyName of propertyNames) {
			if (currentObj[propertyName] !== previousObj[propertyName]) {
				isPropertyChanged = true;
				break;
			}
		}
		
		currentObj.call_LTPChg = parseToFloat((currentObj.call_LTP - previousObj.call_LTP??0),'');
		currentObj.put_LTPChg = parseToFloat((currentObj.put_LTP - previousObj.put_LTP??0),'');
		
		if(isPropertyChanged)
			strikesChanged++;
			
		if(strikesChanged > 4)
			return true;
	}

	return false;
}

async function bulkInsertToElasticsearch(index, data, currentTimeIst) {
	let ltp = parseToFloat(document.querySelector('.instrument-ltp').innerText.replace(/[^0-9.]/g,''),'');
	
	const bulkBody = [];
	bulkBody.push({
		index: { _index: index },
	});
	bulkBody.push({ symbol, ltp, timeStamp: currentTimeIst,expiry, optionChain: data });

	try {
		const response = await fetch('http://localhost:9200/_bulk', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-ndjson',
			},
			body: bulkBody.map(JSON.stringify).join('\n') + '\n',
		});
		if (!response.ok) {
			throw new Error(`Error: ${response.statusText}`);
		}

		const responseData = await response.json();
		console.log('Bulk insert response:', responseData);
	} catch (error) {
		console.error('Error during bulk insert:', error);
	}
}

function getISTISOString() {
	// Create a new Date object representing the current date and time in UTC
	const currentDate = new Date();

	// Get the UTC time in milliseconds
	const utcTime = currentDate.getTime();

	// IST offset in milliseconds (5 hours 30 minutes)
	const istOffset = 5.5 * 60 * 60 * 1000;

	// Calculate IST time in milliseconds
	const istTime = new Date(utcTime + istOffset);

	// Format the IST time to ISO 8601 string
	const isoString = istTime.toISOString(); //.replace('Z', '+05:30');

	return isoString;
}

function getQueryStringParameterByName(name) {
    // Get the full query string from the current URL
    const queryString = window.location.search;
    
    // Create a URLSearchParams object from the query string
    const urlParams = new URLSearchParams(queryString);
    
    // Get the value of the specified parameter
    return urlParams.get(name);
}
