import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import createPaymentHandler from './api/create-payment.js';
import verifyPaymentHandler from './api/verify-payment.js';
import paymentWebhookHandler from './api/payment-webhook.js';
import uploadImageHandler from './api/upload-image.js';
import processEnrollmentHandler from './api/process-enrollment.js';
import dynamicManifestHandler from './api/dynamic-manifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.get('/api/manifest.json', (req, res) => {
  dynamicManifestHandler(req, res);
});

app.post('/api/create-payment', (req, res) => {
  createPaymentHandler(req, res);
});

app.post('/api/verify-payment', (req, res) => {
  verifyPaymentHandler(req, res);
});

app.post('/api/payment-webhook', (req, res) => {
  paymentWebhookHandler(req, res);
});

app.post('/api/process-enrollment', (req, res) => {
  processEnrollmentHandler(req, res);
});

app.post('/api/upload-image', (req, res) => {
  uploadImageHandler(req, res);
});

if (IS_PRODUCTION) {
  const distPath = join(__dirname, 'dist');
  app.use(express.static(distPath));
  
  app.get('*', (req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { 
      middlewareMode: true,
      host: '0.0.0.0',
      port: 5000,
      strictPort: true,
      hmr: {
        clientPort: 443,
        protocol: 'wss',
      }
    },
    appType: 'spa',
  });
  
  app.use(vite.middlewares);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${IS_PRODUCTION ? 'production' : 'development'}`);
  console.log(`Serving from: ${IS_PRODUCTION ? 'dist/' : 'vite dev server'}`);
});
