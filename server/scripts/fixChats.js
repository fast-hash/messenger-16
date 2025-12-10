// Простая очистка повреждённых записей чатов для dev-среды
require('dotenv').config();
const mongoose = require('mongoose');
const Chat = require('../src/models/Chat');

const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/messenger_basic';

async function run() {
  try {
    await mongoose.connect(mongoUrl);
    console.log('Подключение к Mongo успешно');

    // Удаляем заявки без пользователя, чтобы избежать валидационных ошибок
    const cleanJoin = await Chat.updateMany(
      { 'joinRequests.user': { $exists: false } },
      { $set: { joinRequests: [] } }
    );
    console.log('Очищено joinRequests без user:', cleanJoin.modifiedCount);

    // Чаты, где участники сохранены в виде строки, приводим к пустому списку
    const brokenParticipants = await Chat.find({
      $or: [
        { participants: { $type: 'string' } },
        { 'participants.0': { $type: 'string' } },
      ],
    });
    console.log('Чатов с некорректными participants:', brokenParticipants.length);

    for (const chat of brokenParticipants) {
      chat.participants = [];
      await chat.save();
      console.log(`Исправлен chat ${chat._id}`);
    }
  } catch (err) {
    console.error('Ошибка в fix-chats:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Отключение от Mongo завершено');
  }
}

run();
