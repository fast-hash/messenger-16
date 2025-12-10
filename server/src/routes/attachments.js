const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const authMiddleware = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const attachmentService = require('../services/attachmentService');

// Список разрешенных типов. Мы доверяем только тому, что покажет file-type,
// а не тому, что прислал пользователь.
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/plain', // .txt (исключение, у него нет магических чисел)
];

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Настройка хранилища (как и было)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const chatId = req.params.chatId;
    const dest = path.join(attachmentService.uploadsRoot, chatId);
    // Создаем папку, если её нет
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    // Генерируем уникальное имя
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
});

const router = express.Router();
router.use(authMiddleware);

const validateChatAccess = asyncHandler(async (req, res, next) => {
  await attachmentService.ensureChatAccess(req.params.chatId, req.user.id);
  next();
});

// Функция для удаления файлов, если проверка не прошла
const cleanupFiles = (files) => {
  if (!files || !Array.isArray(files)) return;
  files.forEach((file) => {
    if (file.path && fs.existsSync(file.path)) {
      fs.unlink(file.path, (err) => {
        if (err) console.error(`Ошибка при удалении файла ${file.path}:`, err);
      });
    }
  });
};

router.post(
  '/chats/:chatId/attachments',
  validateChatAccess,
  upload.array('files', MAX_FILES),
  asyncHandler(async (req, res) => {
    // 1. Проверяем, загрузил ли Multer файлы
    if (!req.files || !req.files.length) {
      return res.status(400).json({ message: 'Нет файлов для загрузки' });
    }

    try {
      // 2. Подключаем библиотеку file-type динамически
      const { fileTypeFromFile } = await import('file-type');

      for (const file of req.files) {
        // 3. Читаем "магические байты" (реальный тип файла)
        const typeInfo = await fileTypeFromFile(file.path);
        
        // Определенный тип или fallback для текстовых файлов
        let detectedMime = typeInfo ? typeInfo.mime : null;

        // Исключение для текстовых файлов (у них нет сигнатуры)
        if (!detectedMime && (file.mimetype === 'text/plain' || path.extname(file.originalname) === '.txt')) {
           detectedMime = 'text/plain';
        }

        // 4. Главная проверка безопасности
        if (!detectedMime || !ALLOWED_MIME_TYPES.includes(detectedMime)) {
          throw new Error(`Файл "${file.originalname}" имеет недопустимый формат (${detectedMime || 'неизвестен'}).`);
        }

        // Дополнительная защита: явно ловим исполняемые файлы (EXE, DLL и т.д.)
        if (detectedMime === 'application/x-msdownload' || detectedMime === 'application/x-executable') {
            throw new Error(`Обнаружен исполняемый файл! Загрузка запрещена.`);
        }
      }

      // 5. Если всё хорошо, сохраняем информацию в БД
      const attachments = await attachmentService.saveMetadata({
        chatId: req.params.chatId,
        uploaderId: req.user.id,
        files: req.files,
      });

      return res.status(201).json({ attachments });

    } catch (error) {
      // 6. Если ошибка — удаляем всё, что успели загрузить в этом запросе
      cleanupFiles(req.files);
      
      console.warn(`Ошибка загрузки файлов (User: ${req.user.id}): ${error.message}`);
      return res.status(400).json({ message: error.message || 'Ошибка проверки файлов' });
    }
  })
);

// Роут скачивания (безопасные заголовки уже добавлены в твоем коде ранее, здесь повторяем для целостности)
router.get(
  '/attachments/:id',
  asyncHandler(async (req, res) => {
    const { attachment, filePath } = await attachmentService.getAttachmentForDownload({
      attachmentId: req.params.id,
      requesterId: req.user.id,
    });

    // Картинки показываем в браузере, остальное - скачиваем
    const isImage = attachment.mimeType && attachment.mimeType.startsWith('image/');
    const disposition = isImage ? 'inline' : 'attachment';

    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(attachment.originalName || 'file')}"`
    );
    // Защита от исполнения скриптов в браузере
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      res.status(404).end();
    });
    
    stream.pipe(res);
  })
);

module.exports = router;