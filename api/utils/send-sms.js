const BULKSMS_API_URL = 'http://bulksmsbd.net/api/smsapi';
const BULKSMS_API_KEY = process.env.BULKSMS_API_KEY;
const BULKSMS_SENDER_ID = process.env.BULKSMS_SENDER_ID;

export async function sendEnrollmentSMS(mobileNumber, userName, courses) {
  if (!BULKSMS_API_KEY || !BULKSMS_SENDER_ID) {
    console.warn('SMS API credentials not configured. Skipping SMS notification.');
    return { success: false, error: 'SMS credentials not configured' };
  }

  if (!mobileNumber) {
    console.warn('No mobile number provided. Skipping SMS notification.');
    return { success: false, error: 'No mobile number provided' };
  }

  try {
    const courseName = courses?.length > 1 
      ? `${courses.length} courses` 
      : courses?.[0]?.title || 'course';

    const message = `Hello, ${userName || 'Student'} you have successfully enrolled to "${courseName}" course.
Regards, Easy Education Team

Join Here:
https://t.me/Easy_Education_01`;

    const formattedNumber = mobileNumber.startsWith('88') ? mobileNumber : `88${mobileNumber}`;

    const requestBody = {
      api_key: BULKSMS_API_KEY,
      senderid: BULKSMS_SENDER_ID,
      number: formattedNumber,
      message: message
    };

    console.log(`Sending SMS to ${formattedNumber}: ${message}`);

    const response = await fetch(BULKSMS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json();
    
    if (result.response_code === 202 || result.response_code === '202') {
      console.log(`✅ SMS sent successfully to ${formattedNumber}`);
      return { success: true, result };
    } else {
      console.error(`❌ SMS failed with code ${result.response_code}: ${getSMSErrorMessage(result.response_code)}`);
      return { success: false, error: getSMSErrorMessage(result.response_code), code: result.response_code };
    }
  } catch (error) {
    console.error('Error sending SMS:', error);
    return { success: false, error: error.message };
  }
}

function getSMSErrorMessage(code) {
  const errorMessages = {
    '1001': 'Invalid Number',
    '1002': 'Sender ID not correct/disabled',
    '1003': 'Please provide all required fields',
    '1005': 'Internal Error',
    '1006': 'Balance Validity Not Available',
    '1007': 'Balance Insufficient',
    '1011': 'User ID not found',
    '1012': 'Masking SMS must be sent in Bengali',
    '1013': 'Sender ID has not found Gateway by API key',
    '1014': 'Sender Type Name not found using this sender by API key',
    '1015': 'Sender ID has not found Any Valid Gateway by API key',
    '1016': 'Sender Type Name Active Price Info not found by this sender ID',
    '1017': 'Sender Type Name Price Info not found by this sender ID',
    '1018': 'The Owner of this account is disabled',
    '1019': 'The Price of this account is disabled',
    '1020': 'The parent of this account is not found',
    '1021': 'The parent active price of this account is not found',
    '1031': 'Your Account Not Verified, Please Contact Administrator',
    '1032': 'IP Not whitelisted'
  };
  return errorMessages[String(code)] || `Unknown error code: ${code}`;
}
