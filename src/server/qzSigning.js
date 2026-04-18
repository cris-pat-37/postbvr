import { createSign } from 'crypto';
import { readFile } from 'fs/promises';

const normalizePem = (value) => (value ? value.replace(/\\n/g, '\n').trim() : '');

const readPemFromEnv = async (valueKey, fileKey) => {
  const inlineValue = normalizePem(process.env[valueKey]);
  if (inlineValue) {
    return inlineValue;
  }

  const filePath = process.env[fileKey];
  if (!filePath) {
    return '';
  }

  const fileValue = await readFile(filePath, 'utf8');
  return normalizePem(fileValue);
};

export const getQzCertificate = async () => readPemFromEnv('QZ_TRAY_CERTIFICATE', 'QZ_TRAY_CERTIFICATE_FILE');

export const getQzPrivateKey = async () => readPemFromEnv('QZ_TRAY_PRIVATE_KEY', 'QZ_TRAY_PRIVATE_KEY_FILE');

export const signQzPayload = async (payload) => {
  const privateKey = await getQzPrivateKey();
  if (!privateKey) {
    throw new Error('QZ private key is not configured.');
  }

  const signer = createSign('RSA-SHA512');
  signer.update(payload, 'utf8');
  signer.end();
  return signer.sign(privateKey, 'base64');
};
