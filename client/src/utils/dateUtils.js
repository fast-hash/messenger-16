// Утилиты форматирования времени сообщений под локальную тайм-зону
const pad = (value) => value.toString().padStart(2, '0');

const formatTimeOnly = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

const formatFullDateTime = (date) =>
  `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${formatTimeOnly(date)}`;

export const formatMessageDate = (dateInput) => {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  if (date >= startOfToday) {
    return formatTimeOnly(date);
  }

  if (date >= startOfYesterday) {
    return `Вчера ${formatTimeOnly(date)}`;
  }

  return formatFullDateTime(date);
};
