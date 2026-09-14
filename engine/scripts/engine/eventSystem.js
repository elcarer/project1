const EventSystem = {
    // Хранилище всех слушателей событий
    listeners: new Map(),
    // Метод для ПОДПИСКИ на событие
    on(event, callback) {
        // Проверяем, есть ли уже слушатели для этого события
        if (!this.listeners.has(event)) {
            // Если нет - создаем пустой массив
            this.listeners.set(event, []);
        }
        // Добавляем callback в массив слушателей
        this.listeners.get(event).push(callback);
        
        // Возвращаем функцию для отписки (полезно!)
        return () => this.off(event, callback);
    },
    // Метод для ОТПИСКИ от события (добавим его)
    off(event, callback) {
        if (!this.listeners.has(event)) return;
        
        const callbacks = this.listeners.get(event);
        const index = callbacks.indexOf(callback);
        if (index !== -1) {
            callbacks.splice(index, 1);
        }
    },
    // Метод для ГЕНЕРАЦИИ события
    emit(event, data) {
        // Получаем всех слушателей этого события
        const callbacks = this.listeners.get(event);
        // Если есть слушатели - вызываем каждый
        if (callbacks) {
            // Создаем копию массива, чтобы можно было безопасно
            // добавлять/удалять слушателей во время emit
            [...callbacks].forEach(callback => {
                callback(data);
            });
        }
    },
    // Метод для ПОДПИСКИ на событие ОДИН РАЗ
    once(event, callback) {
        const wrapper = (data) => {
            callback(data);
            this.off(event, wrapper);
        };
        this.on(event, wrapper);
    },
    // Очистить все слушатели определенного события
    clear(event) {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }
};

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.EventSystem = EventSystem;
