var runonce = 1;
const index = 'optionchain';
var propertyNamesToMonitor = [];
var currentArray, previousArray, previousIndexLtp;
var expiry = new Date();
var symbol = '';
var cacheKey = '';
const propertyNamesToCheckForChange = ['OI', 'OIChg)'];
const HDR_ROW = 1;
var isPageLoaded = false;
var clearCacheForCurrentExpiry = false;
var Start_Option_History_Replay = false;
var isCurrentHistoryDumpComplete = false;
var isCurrentHistoryDumpRetry = false;
var isHistoricalDataLoadFinished = false;

function isCurrentUrlMatching() {
	const regex =
		/^https:\/\/*\.in\/instruments.*currentTab=option_chain$/;
	const currentUrl = window.location.href;
	return regex.test(currentUrl);
}

function LoadOptionChain(a, b) {
	let isError = false;
	try {
		//Enable absolute value
		InitPage();
		
		if (!isPageLoaded) return;
		
		var currentTimeIst = getISTISOString(new Date());
		let expiryDateStr = getExpiryDate(); //getQueryStringParameterByName('expiry');
		expiry = new Date(expiryDateStr).toISOString();
		symbol = getSymbol();
		
		if (IsHistoricalData()) {
			currentTimeIst = getHistoricalTimeStamp();
		}
		else
		{
			currentTimeIst = getISTISOString(findImmediatePreviousInterval(new Date(), intervals));
		}
		let datePart = currentTimeIst.split('T')[0];
		cacheKey = `${index}-${expiry}-${symbol}-${datePart}`;
		
		if (runonce === 1 && clearCacheForCurrentExpiry) localStorage.removeItem(cacheKey);
		
		let ltp = parseToFloat(getSpotLtp());
		const cachedData = JSON.parse(localStorage.getItem(cacheKey)) || {};
		previousIndexLtp = cachedData?.previousIndexLtp??ltp;
		previousArray = cachedData.previousArray;
		/*
				if (runonce === 1) {debugger;previousArray=null;
				removeElem('.option-chain-table thead:first-child');
				}
		*/
		
		var currentArray = extractTable('option-chain-table');
		if (havePropertiesChanged(currentArray, previousArray, propertyNamesToMonitor)) {
			bulkInsertToElasticsearch(index, currentArray, currentTimeIst, ltp);
			previousArray = Array.from(currentArray);
			localStorage.setItem(cacheKey, JSON.stringify({previousIndexLtp : ltp, previousArray}));
		}

		runonce++;
	} catch (ex) {
		isError = true;
		isCurrentHistoryDumpRetry = true;
		console.log(ex);
	} finally {
		isCurrentHistoryDumpComplete = !isError;
		if(IsHistoricalData() && isHistoricalDataLoadFinished)
		{
			return;
		}
		else
		{
			setTimeout(LoadOptionChain, 5000);
		}
	}
}

function InitPage()
{
	let isAbsoluteSelected = checkCheckboxByClassAndId('form-check-input', 'absoluteChange');
	let isIntervalSetTo3Min = setChangeDetectionInterval();
	isPageLoaded = isAbsoluteSelected && isIntervalSetTo3Min;
}

function getSymbol() {
	let symbol = document.querySelector(
		`.instrument-header [data-track-category="Instrument Selector"] .select__control .select-text-style`
	).innerText;
	return symbol.replace(/\s+/g, '');
}

function getSpotLtp() {
	let ltp = document.querySelector(
		`.instrument-header [data-track-category="Instrument Selector"] .select__control .ltp-format`
	).innerText;
	return ltp.replace(/\s+/g, '').replace(/,/g, '');
}

function getExpiryDate() {
	let expDate = document.querySelector(`.instrument-header [data-track-category="ExiryDate Selector"] .form-select`);
	let expDateStr = expDate[expDate.selectedIndex].value
	return expDateStr.replace(/\s+/g, '');
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
		for (var a = HDR_ROW; a < table.rows[HDR_ROW].cells.length; a++) {
			if (
				table.rows[1].cells[a].innerText.replace(/[^a-zA-Z\+\-\%]/g, '') ===
				'Strike'
			) {
				indexOfStrike = a;
				break;
			}
		}

		// Generate headers
		for (var i = 0; i < table.rows[HDR_ROW].cells.length; i++) {
			let initial =
				i === indexOfStrike ? '' : i < indexOfStrike ? 'call_' : 'put_';
			let htmlHdrName = getHtmlHdrName(table, HDR_ROW, i);
			if(htmlHdrName === 'PCR') {
				header.push(htmlHdrName);
			} else if (isOiChangeHeader(htmlHdrName)) {
				header.push(initial + 'OI');
				header.push(initial + 'OIChg');
			} else if (isLtpHeader(htmlHdrName)) {
				header.push(initial + 'LTP');
			} else {
				header.push(initial + htmlHdrName);
			}
		}

		if (runonce === 1) {
			header.forEach((htmlHdrName, index) => {
				if (
					propertyNamesToCheckForChange.some((substring) =>
						htmlHdrName.includes(substring)
					)
				)
					propertyNamesToMonitor.push(htmlHdrName);
			});
		}

		// Extract rows
		for (var i = HDR_ROW + 1; i < table.rows.length; i++) {
			var row = {};
			let k = 0;
			for (var j = 0; j < table.rows[i].cells.length; j++) {
				let stringValue = table.rows[i].cells[j].innerText.replace(/,/g, '');
				let { mainValue, changedVal } = extractNumericParts(stringValue);

				if (isOiChangeHeader(getHtmlHdrName(table, HDR_ROW, j))) {
					mainValue = getInLakhs(mainValue);
					changedVal = getInLakhs(changedVal);
				}
				//let stringValue = table.rows[i].cells[j].innerText.replace(/[^0-9.\+\-\%]/g, '');
				let parsedVal = parseToFloat(mainValue, header[k]);
				row[header[k++]] = parsedVal;

				if (isOiChangeHeader(getHtmlHdrName(table, HDR_ROW, j))) {
					row[header[k++]] = parseToFloat(changedVal, header[k]);
				}
			}
			row.call_LTPChg = parseToFloat(0, '');
			row.put_LTPChg = parseToFloat(0, '');
			row.OIDiff = parseToFloat((row.put_OI - row.call_OI), '');
			row.OIDiff_Chg = parseToFloat(0, '');
			row.OIChgDiff = parseToFloat((row.put_OIChg - row.call_OIChg), '');
			row.OIChgDiff_Chg = parseToFloat(0, '');
			
			rows.push(row);
		}
		return rows;
	}
	return [];
}

function parseToFloat(input, hdrName) {
	var output = input;
	if (hdrName && hdrName.includes('Strike')) {
		output = parseFloat(input.replace(/,/g, ''));
	} else {
		if(input === '-')
		{
			output = '0';
		}
		if (typeof input === 'string') {
			let parsed = parseFloat(input);
			if (!isNaN(parsed)) {
				output = stringToFloatConverter(input);
			}
		} else if (typeof input === 'number') {
			input = input.toString();
			output = stringToFloatConverter(input);
		}
	}
	return output;
}

function stringToFloatConverter(input) {
	let parsed = 0;
	let parts = input.split('.');
	let lastPart = '';
	if(parts.length == 0)
	{
		input = '0.001';
	}
	else
	{
		if(parts.length >= 1 && parts[0] === '')
				parts[0] = '0';
				
		if (parts.length === 1)
			lastPart = '001';
		else
		{
			switch(parts[1].length)
			{
				case 0: lastPart = '001';break;
				case 1: lastPart = parts[1].substring(0, 1) + '01';break;
				default: lastPart = parts[1].substring(0, 2) + '1'; break;
			}
		}
		input = parts[0] + '.' + lastPart;
	}
	return parseFloat(input);
}

function havePropertiesChanged(currentArray, previousArray, propertyNames) {
	if (!previousArray || previousArray.length == 0) {
		return true;
	}
	var strikesChanged = 0;
	for (let i = 0; i < currentArray.length; i++) {
		var isPropertyChanged = false;
		const currentObj = currentArray[i];

		const previousObj = previousArray.find(
			(obj) => obj.Strike === currentObj.Strike
		);

		if (!previousObj) continue;

		currentObj.call_LTPChg = parseToFloat(
			(currentObj.call_LTP - previousObj.call_LTP),
			''
		);
		
		currentObj.put_LTPChg = parseToFloat(
			(currentObj.put_LTP - previousObj.put_LTP),
			''
		);
		
		currentObj.OIChgDiff_Chg = parseToFloat(
			(currentObj.OIChgDiff - previousObj.OIChgDiff),
			''
		);
		
		currentObj.OIDiff_Chg = parseToFloat(
			(currentObj.OIDiff - previousObj.OIDiff),
			''
		);
		for (const propertyName of propertyNames) {
			if (currentObj[propertyName] !== previousObj[propertyName]) {
				isPropertyChanged = true;
				break;
			}
		}

		if (isPropertyChanged) strikesChanged++;
	}
	if (strikesChanged > 4) return true;

	return false;
}

async function bulkInsertToElasticsearch(index, data, currentTimeIst, ltp) {
	const bulkBody = [];

	const documentId = `${symbol}_${expiry}_${currentTimeIst}`; // Create a unique ID for the document
	bulkBody.push({
		update: { _index: index, _id: documentId },
	});
	bulkBody.push({
        doc: {
            symbol,
            ltp,
            ltp_Chg: parseToFloat(ltp - previousIndexLtp),
            timeStamp: currentTimeIst,
            expiry,
            optionChain: data,
        },
        doc_as_upsert: true, // This ensures the document is inserted if it does not exist
    });

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
		console.log(
			`${new Date().toISOString()} : Bulk insert response:`,
			responseData
		);
	} catch (error) {
		console.error('Error during bulk insert:', error);
	}
}

function getISTISOString(date) {
	// Create a new Date object representing the current date and time in UTC
	const currentDate = date;

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

function getHistoricalTimeStamp() {
	const months = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec',
	];
	// Select the date element
	const dateElement = document.querySelector(
		'.date-time-picker-box .date span'
	);

	// Select the time input element
	const timeInputElement = document.querySelector(
		'.date-time-picker-box .react-time-picker__inputGroup input[name="time"]'
	);

	// Extract the date and time values
	const dateText = dateElement.textContent.trim();
	const timeValue = timeInputElement.value.trim();

	// Parse the date and time values
	const [day, month, year] = dateText.split('-');
	// Format the date into ISO 8601 format
	const isoDate = getISTISOString(
		new Date(
			year,
			months.indexOf(month),
			day,
			timeValue.split(':')[0],
			timeValue.split(':')[1],
			0
		)
	);
	return isoDate;
}

function getQueryStringParameterByName(name) {
	// Get the full query string from the current URL
	const queryString = window.location.search;

	// Create a URLSearchParams object from the query string
	const urlParams = new URLSearchParams(queryString);

	// Get the value of the specified parameter
	return urlParams.get(name);
}

function isOiChangeHeader(hdrName) {
	return hdrName === 'OIChange';
}

function isLtpHeader(hdrName) {
	return hdrName === 'LTPChange';
}

const checkCheckboxByClassAndId = (className, id) => {
	let success = false;
	let checkbox = null;
	try
	{
		checkbox = document.querySelector(`.${className}#${id}`);
		if (checkbox) {
			if (!checkbox.checked) {
				checkbox.click();
			}
		} else {
			alert(`Checkbox with class name "${className}" and ID "${id}" not found.`);
		}
	}
	finally
	{
		success = checkbox && checkbox.checked;
	}
	return success;
};

const setChangeDetectionInterval = (className, id) => {
	let success = false;
	const inputElemntDiff = document.querySelector('.comparision-interval-typehead .form-select');
	try
	{
		if (inputElemntDiff.value !== '3') {
			setNativeValue(inputElemntDiff, '3');
		}
	}
	finally
	{
		success = inputElemntDiff.value === '3';
		isPageLoaded =success;
		if (!success)
		{
			isPageLoaded = false;
		}
	}
	return success;
};



function getHtmlHdrName(table, r, c) {
	return table.rows[r].cells[c].innerText.replace(/[^a-zA-Z\+\-\%]/g, '');
}

function getInLakhs(value) {
	// Use a regular expression to extract the numeric part and the suffix
	if(!value || value === '-')
		return 0;
	
	const regex = /^(-?[\d.]+)([a-zA-Z]*)$/;
	const match = value.match(regex);

	if (!match)
		return 0;

	const numericPart = parseFloat(match[1]);
	const suffix = match[2];

	// Initialize the multiplier
	let multiplier = 1;

	// Determine the multiplier based on the suffix
	switch (suffix) {
		case 'K':
			multiplier = 0.01; // 1K = 0.01 Lakhs
			break;
		case 'L':
			multiplier = 1; // 1L = 1 Lakhs
			break;
		case 'Cr':
			multiplier = 100; // 1Cr = 100 Lakhs
			break;
		default:
			multiplier = .00001;
	}

	return numericPart * multiplier;
}

function extractNumericParts(input) {
	// Remove all whitespaces from the input
	const cleanedInput = input.replace(/\s+/g, '');
	let parts = cleanedInput.split('(');

	parts = parts.map((element) => element.replace(')', ''));
	const mainValue = parts[0];
	const changedVal = parts[1];

	return { mainValue, changedVal };
}

function IsHistoricalData() {
	let checkboxElement = document.querySelector(
		'.live-historical-box .switch-toggle input[type="checkbox"][role="switch"]'
	);
	return checkboxElement.checked;
}



// Wrap the async function call inside a regular function
const callAsyncFunctionStartReplay = () => {
    startReplay();
};
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function setNativeValue(element, value) {
		let valueSetter,prototype,prototypeValueSetter;
		if (element.tagName === 'SELECT')
		{
			element.value = value;
      let changeEvent = new Event('change', { bubbles: true });
      element.dispatchEvent(changeEvent);
		}
		else {
	    valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
	    prototype = Object.getPrototypeOf(element);
	    prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
		
	    if (valueSetter && valueSetter !== prototypeValueSetter) {
	        prototypeValueSetter.call(element, value);
	    } else {
	        valueSetter.call(element, value);
	    }
	
	    // Create and dispatch the input event to notify React of the change
	    const inputEvent = new Event('input', { bubbles: true });
	    element.dispatchEvent(inputEvent);
	
	
	    // Create and dispatch the focusout event
	    const focusOutEvent = new FocusEvent('focusout', { bubbles: true });
	    element.dispatchEvent(focusOutEvent);
		}
}

const startReplay = async () => {
	let interval = 3;
	isHistoricalDataLoadFinished = false;
	
	const inputElementH = document.querySelector('input.react-time-picker__inputGroup__input.react-time-picker__inputGroup__hour');
	
	const inputElementM = document.querySelector('input.react-time-picker__inputGroup__input.react-time-picker__inputGroup__minute');
	
	let lastHour =0,lastMin = -1;
	for(h = 9; h <= 15; h++)
	{
		let start = 1; end = 59;
		if(h === 9)
			start = lastMin === -1 ? 17 : (lastMin + 3 - 60);
		else if(h===15)
			end = 15;
			
		setNativeValue(inputElementH, h);
		
		for(m = start; m <= end; m = m+interval)
		{
			setNativeValue(inputElementM, m);
			isCurrentHistoryDumpComplete = false;
			
			while(!isCurrentHistoryDumpComplete)
			{
				await sleep(2000);//Wait for loading option chain
				if(isCurrentHistoryDumpRetry)
				{
					h = lastHour;
					m = lastMin;
					setNativeValue(inputElementH, h);
					setNativeValue(inputElementM, m);
					await sleep(2000);//Wait for loading option chain
					isCurrentHistoryDumpRetry = false;
					break;
				}
			}
			lastHour = h;
			lastMin = m;
			
		}
	}
	
	isHistoricalDataLoadFinished = true;
	localStorage.removeItem(cacheKey)
}



// Function to set the value and trigger React's change detection
function generateIntervals() {
    const intervals = [];
    let startTime = new Date();
    startTime.setHours(9, 15, 0, 0); // Set start time to 9:15 AM

    const endTime = new Date();
    endTime.setHours(15, 15, 0, 0); // Set end time to 3:15 PM

    while (startTime <= endTime) {
        intervals.push(new Date(startTime));
        startTime.setMinutes(startTime.getMinutes() + 3); // Increment by 3 minutes
    }

    return intervals;
}

function findImmediatePreviousInterval(dateTime, intervals) {
    for (let i = intervals.length - 1; i >= 0; i--) {
        if (intervals[i] <= dateTime) {
            return intervals[i];
        }
    }
    return null; // Return null if no previous interval is found
}

function showConfirmationBox() {
    const confirmationBox = document.createElement('div');
    confirmationBox.style.position = 'fixed';
    confirmationBox.style.top = '50%';
    confirmationBox.style.left = '50%';
    confirmationBox.style.transform = 'translate(-50%, -50%)';
    confirmationBox.style.padding = '20px';
    confirmationBox.style.backgroundColor = 'white';
    confirmationBox.style.border = '1px solid black';
    confirmationBox.style.zIndex = '1000';

    const message = document.createElement('p');
    message.textContent = 'Do you want to proceed?';
    confirmationBox.appendChild(message);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const checkboxLabel = document.createElement('label');
    checkboxLabel.innerHTML = '&nbsp;Clear cache for current expiry?';
    checkboxLabel.insertBefore(checkbox, checkboxLabel.firstChild);
    confirmationBox.appendChild(checkboxLabel);
    
    const lineBreak = document.createElement('br');
    confirmationBox.appendChild(lineBreak);
    
    const checkbox2 = document.createElement('input');
    checkbox2.type = 'checkbox';
    const checkboxLabel2 = document.createElement('label');
    checkboxLabel2.innerHTML = '&nbsp;Start option history replay?';
    checkboxLabel2.insertBefore(checkbox2, checkboxLabel2.firstChild);
    confirmationBox.appendChild(checkboxLabel2);

		const lineBreak2 = document.createElement('br');
    confirmationBox.appendChild(lineBreak2);
    
    const yesButton = document.createElement('button');
    yesButton.textContent = 'Yes';
    yesButton.onclick = () => {
        clearCacheForCurrentExpiry = checkbox.checked;
        Start_Option_History_Replay = checkbox2.checked; 
        document.body.removeChild(confirmationBox);
        
        if(Start_Option_History_Replay)
        	callAsyncFunctionStartReplay();
        	
        LoadOptionChain();
    };
    confirmationBox.appendChild(yesButton);

    const waitButton = document.createElement('button');
    waitButton.textContent = 'Wait 5 Sec';
    waitButton.onclick = () => {
        document.body.removeChild(confirmationBox);
        setTimeout(showConfirmationBox, 5000);
    };
    confirmationBox.appendChild(waitButton);

    const noButton = document.createElement('button');
    noButton.textContent = 'No';
    noButton.onclick = () => {
        document.body.removeChild(confirmationBox);
    };
    confirmationBox.appendChild(noButton);

    document.body.appendChild(confirmationBox);
}

if (isCurrentUrlMatching())
{
	intervals = generateIntervals();
	showConfirmationBox();
}
