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
        return text ? JSON.parse(text) : {};
    } catch (error) {
        return { raw: text };
    }
}

/* --- ПОЛНЫЙ БЛОК ГЕНЕРАЦИИ (High-Res как в Studio) --- */
app.post('/api/generate', upload.single('garment'), async (req, res) => {
    try {
        console.log('VESTRA: Файл получен, начинаю работу...');
        if (!req.file) return res.status(400).json({ success: false, error: 'Файл не загружен' });

        // 1. ПОДГОТОВКА ИЗОБРАЖЕНИЯ (Оптимизация размера для устранения ошибки 500)
        const processedBuffer = await sharp(req.file.buffer)
            // Ограничиваем размер до 1200px по большой стороне. Это критично для API!
            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
            .toFormat('jpeg')
            .jpeg({ quality: 80 }) // Снижаем качество до 80 (визуально не заметно, вес падает в разы)
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
            throw new Error(startData.message || startData.error || `FASHN API error (${response.status})`);
        }

        if (!startData.id) {
            console.error('Ошибка старта tryon-max:', startData);
            throw new Error(startData.message || 'Модель tryon-max отклонила запрос');
        }
        
        const predictionId = startData.id;
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
                throw new Error(statusData.message || statusData.error || `FASHN status error (${statusRes.status})`);
            }

            console.log(`VESTRA: Статус [${attempts}]: ${statusData.status}`);

            if (statusData.status === 'completed') {
                resultUrl = statusData.output[0];
            } else if (statusData.status === 'failed') {
                console.error('Ошибка ИИ:', statusData.error);
                throw new Error('ИИ не справился. Попробуйте другой фон.');
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

const PORT = 3000;
app.listen(PORT, () => console.log(`СЕРВЕР ЗАПУЩЕН: http://localhost:${PORT}`));
