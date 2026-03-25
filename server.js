require('dotenv').config();

const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const sharp = require('sharp'); 
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// --- НАСТРОЙКИ ---
// API ключ берём из окружения
const FASHN_API_KEY = process.env.FASHN_API_KEY;
const FASHN_API_URL = 'https://api.fashn.ai/v1/run';
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
]);

// Новая ссылка на модель из твоего архива
const DEFAULT_MODEL_URL = "https://cdn.fashn.ai/3ed83a1a-0561-4447-8840-3314befe9f8b/try_on_0.png";

if (!FASHN_API_KEY) {
    throw new Error('FASHN_API_KEY is not set. Add it to your .env file.');
}

app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Vary', 'Origin');
    } else {
        res.header('Access-Control-Allow-Origin', '*');
    }

    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
});

app.use(express.static('.'));
app.use(express.json());

async function parseJsonSafely(response) {
    const text = await response.text();
    try {
        return {
            ok: true,
            data: text ? JSON.parse(text) : {},
            raw: text,
            contentType: response.headers.get('content-type') || '',
            status: response.status
        };
    } catch (error) {
        return {
            ok: false,
            data: null,
            raw: text,
            contentType: response.headers.get('content-type') || '',
            status: response.status
        };
    }
}

function formatUpstreamError(parsed, fallbackMessage) {
    const raw = (parsed?.raw || '').trim();

    if (!raw) {
        return `${fallbackMessage}: upstream service returned an empty response`;
    }

    if (raw.startsWith('<')) {
        return `${fallbackMessage}: upstream service returned HTML instead of JSON`;
    }

    return fallbackMessage;
}

async function validateUploadedImage(file) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        return { ok: false, error: 'Unsupported file format' };
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
        return { ok: false, error: 'File is too large' };
    }

    let metadata;
    let stats;

    try {
        metadata = await sharp(file.buffer).metadata();
        stats = await sharp(file.buffer).stats();
    } catch (error) {
        return { ok: false, error: 'Unreadable or corrupted image' };
    }

    const width = metadata.width || 0;
    const height = metadata.height || 0;

    // The original public flow accepted medium-resolution product shots.
    // Keep obviously tiny uploads out, but allow normal marketplace images through.
    if (Math.min(width, height) < 700) {
        return { ok: false, error: 'Image resolution is too low' };
    }

    const ratio = width / height;
    if (ratio < 0.5 || ratio > 2.0) {
        return { ok: false, error: 'Invalid image aspect ratio' };
    }

    const colorChannels = stats.channels.slice(0, 3);
    const meanBrightness = colorChannels.reduce((sum, channel) => sum + channel.mean, 0) / colorChannels.length;
    const totalStdev = colorChannels.reduce((sum, channel) => sum + channel.stdev, 0);

    if (totalStdev < 18) {
        return { ok: false, error: 'Image is too empty or nearly blank' };
    }

    if (meanBrightness < 35 || meanBrightness > 245) {
        return { ok: false, error: 'Image is too dark or overexposed' };
    }

    try {
        const blurStats = await sharp(file.buffer)
            .greyscale()
            .convolve({
                width: 3,
                height: 3,
                kernel: [
                    0, -1, 0,
                    -1, 4, -1,
                    0, -1, 0
                ]
            })
            .stats();

        const blurScore = blurStats.channels[0]?.stdev || 0;
        if (blurScore < 12) {
            return { ok: false, error: 'Image is too blurry' };
        }
    } catch (error) {
        return { ok: false, error: 'Unreadable or corrupted image' };
    }

    return { ok: true };
}

/* --- ПОЛНЫЙ БЛОК ГЕНЕРАЦИИ (High-Res как в Studio) --- */
app.post('/api/generate', upload.single('garment'), async (req, res) => {
    try {
        console.log('VESTRA: Файл получен, начинаю работу...');
        if (!req.file) return res.status(400).json({ success: false, error: 'Файл не загружен' });

        const validation = await validateUploadedImage(req.file);
        if (!validation.ok) {
            console.log('VESTRA: Валидация файла отклонена:', validation.error);
            return res.status(400).json({ success: false, error: validation.error });
        }

        // 1. ПОДГОТОВКА ИЗОБРАЖЕНИЯ (Синхронизация пропорций с финальной генерацией 3392x5056)
        const processedBuffer = await sharp(req.file.buffer)
            .resize(1024, 1526, { // Пропорция 1:1.49 (как у 3392x5056)
                fit: 'contain',   // Вписываем одежду целиком без искажений
                background: { r: 255, g: 255, b: 255 } // Белый фон для пустых полей
            })
            .toFormat('jpeg')
            .jpeg({ quality: 80 })
            .toBuffer();

        const garmentBase64 = processedBuffer.toString('base64');

     // 2. ОТПРАВКА ЗАПРОСА (Модель tryon-max с обязательными ключами)
        const response = await fetch(FASHN_API_URL, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${FASHN_API_KEY}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({
                model_name: "tryon-max", 
                inputs: {
                    // Используем ключи, которые обязательны для этой модели
                    product_image: `data:image/jpeg;base64,${garmentBase64}`,
                    model_image: DEFAULT_MODEL_URL,
                    // Лаконичный промпт для повышения стабильности сервера
                    prompt: "High-quality fashion photo, preserve all garment details and buttons exactly."
                }
            })
        });

        const startData = await parseJsonSafely(response);
        if (!response.ok) {
            console.error('FASHN run error:', response.status, startData);
            const upstreamMessage = startData.ok
                ? startData.data?.message || startData.data?.error
                : null;
            throw new Error(upstreamMessage || formatUpstreamError(startData, `FASHN API error (${response.status})`));
        }

        if (!startData.ok) {
            console.error('FASHN run returned non-JSON:', startData);
            throw new Error(formatUpstreamError(startData, 'FASHN API returned an invalid response'));
        }

        if (!startData.data?.id) {
            console.error('Ошибка старта tryon-max:', startData);
            throw new Error(startData.data?.message || 'Модель tryon-max отклонила запрос');
        }
        
        const predictionId = startData.data.id;
        console.log(`VESTRA: Мощная генерация запущена (ID: ${predictionId}). Ждем прорисовки...`);
        // 3. ЦИКЛ ОЖИДАНИЯ (Polling)
        let resultUrl = null;
        let attempts = 0;
        while (!resultUrl && attempts < 60) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const statusRes = await fetch(`https://api.fashn.ai/v1/status/${predictionId}`, {
                headers: { 'Authorization': `Bearer ${FASHN_API_KEY}` }
            });
            const statusData = await parseJsonSafely(statusRes);

            if (!statusRes.ok) {
                console.error('FASHN status error:', statusRes.status, statusData);
                const upstreamMessage = statusData.ok
                    ? statusData.data?.message || statusData.data?.error
                    : null;
                throw new Error(upstreamMessage || formatUpstreamError(statusData, `FASHN status error (${statusRes.status})`));
            }

            if (!statusData.ok) {
                console.error('FASHN status returned non-JSON:', statusData);
                throw new Error(formatUpstreamError(statusData, 'FASHN status endpoint returned an invalid response'));
            }

            console.log(`VESTRA: Статус [${attempts}]: ${statusData.data?.status}`);

            if (statusData.data?.status === 'completed') {
                resultUrl = statusData.data?.output?.[0] || null;
            } else if (statusData.data?.status === 'failed') {
                console.error('Ошибка ИИ:', statusData.data?.error);
                throw new Error(statusData.data?.error || 'ИИ не справился. Попробуйте другой фон.');
            }
        }

        if (!resultUrl) throw new Error('Превышено время ожидания');

        console.log('VESTRA: УСПЕХ! Генерация завершена.');
        res.json({ success: true, output_url: resultUrl });

    } catch (error) {
        console.error('ОШИБКА СЕРВЕРА:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
/* --- КОНЕЦ БЛОКА ГЕНЕРАЦИИ --- */

app.use('/api', (req, res) => {
    res.status(404).json({
        success: false,
        error: `API route not found: ${req.method} ${req.originalUrl}`
    });
});

app.use((error, req, res, next) => {
    if (!req.path.startsWith('/api/')) {
        return next(error);
    }

    console.error('API ERROR:', error.message);

    if (res.headersSent) {
        return next(error);
    }

    const statusCode = error.statusCode || error.status || 500;
    res.status(statusCode).json({
        success: false,
        error: error.message || 'Server error'
    });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`СЕРВЕР ЗАПУЩЕН: http://localhost:${PORT}`));
