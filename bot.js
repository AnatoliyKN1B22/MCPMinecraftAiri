/**
 * MINEFLAYER AI BOT З ІНТЕГРАЦІЄЮ LM STUDIO
 * 
 * Функції:
 * - Розумне прийняття рішень через LM Studio (локальний LLM)
 * - Автоматична перевірка інвентарю та крафт
 * - Виживання (їжа, сон, захист)
 * - Покращення бази та ферм
 * - Пам'ять про побудоване
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear, GoalBlock, GoalXZ, GoalReachable } = goals;
const vec3 = require('vec3');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // Для запитів до LM Studio

// --- КОНФІГУРАЦІЯ ---
const CONFIG = {
    host: process.argv[2] || 'localhost',
    port: parseInt(process.argv[3]) || 25565,
    username: process.argv[4] || 'SmartBot',
    password: process.argv[5],
    
    // Налаштування LM Studio
    lmStudio: {
        url: process.env.LM_URL || 'http://localhost:1234/v1/chat/completions',
        model: process.env.LM_MODEL || 'local-model',
        enabled: process.env.LM_ENABLED === 'true' // Ввімкнути розумний режим
    },
    
    memoryFile: path.join(__dirname, 'memory.json')
};

// --- ПАМ'ЯТЬ ТА СТАН ---
let memory = {
    basePosition: null,
    builtStructures: [],
    inventoryLog: {},
    lastTask: "Виживання та розвідка"
};

let bot;
let mcData;
let isBusy = false;

// --- ЗАВАНТАЖЕННЯ ПАМ'ЯТІ ---
function loadMemory() {
    if (fs.existsSync(CONFIG.memoryFile)) {
        try {
            memory = JSON.parse(fs.readFileSync(CONFIG.memoryFile));
            console.log('🧠 Пам\'ять завантажено.');
        } catch (e) {
            console.error('Помилка читання пам\'яті.');
        }
    }
}

function saveMemory() {
    fs.writeFileSync(CONFIG.memoryFile, JSON.stringify(memory, null, 2));
}

// --- ІНТЕГРАЦІЯ З LM STUDIO ---
async function askAI(context) {
    if (!CONFIG.lmStudio.enabled) {
        // Якщо LM Studio вимкнено, повертаємо стандартну відповідь
        return simpleDecisionLogic(context);
    }

    try {
        const response = await axios.post(CONFIG.lmStudio.url, {
            model: CONFIG.lmStudio.model,
            messages: [
                { role: "system", content: "Ти розумний асистент бота для Minecraft. Твоя мета - виживання, будівництво та розвиток. Відповідай ТОЛЬКИ назвою дії з списку: [mine, build, craft, eat, sleep, explore, defend, farm]. Не пиши нічого зайвого." },
                { role: "user", content: context }
            ],
            temperature: 0.7,
            max_tokens: 10
        });

        const action = response.data.choices[0].message.content.trim().toLowerCase();
        console.log(`🤖 LM Studio вирішила: ${action}`);
        return action;
    } catch (error) {
        console.error('❌ Помилка з\'єднання з LM Studio:', error.message);
        console.log('⚠️ Перехід на резервну логіку.');
        return simpleDecisionLogic(context);
    }
}

// Резервна логіка (якщо немає ШІ)
function simpleDecisionLogic(context) {
    if (context.includes("голод") || context.includes("low health")) return "eat";
    if (context.includes("ніч") || context.includes("темно")) return "sleep";
    if (context.includes("ворог") || context.includes("mob")) return "defend";
    if (context.includes("інструмент") || context.includes("tool")) return "craft";
    return "explore";
}

// --- ОСНОВНІ МЕХАНІКИ ---

async function checkInventoryAndCraft(needs) {
    // Аналіз інвентарю
    const inventory = bot.inventory.items();
    const hasItem = (name) => inventory.some(i => i.name.includes(name));
    
    let actions = [];

    // 1. Їжа
    if (!hasItem('cooked') && !hasItem('bread') && !hasItem('apple')) {
        actions.push("У мене немає їжі. Треба знайти або приготувати.");
    }

    // 2. Інструменти
    if (needs === 'mine' && !hasItem('pickaxe')) {
        actions.push("Потрібна кирка. Шукаю дерево та камінь для крафту.");
        await craftTool('pickaxe');
    }
    if (needs === 'defend' && !hasItem('sword')) {
        actions.push("Потрібен меч для захисту.");
        await craftTool('sword');
    }

    // 3. Будівельні матеріали
    if (needs === 'build' && inventory.length < 5) {
        actions.push("Мало ресурсів для будівництва. Йду копати.");
    }

    return actions.length > 0 ? actions.join(" ") : "Інвентар в порядку.";
}

async function craftTool(toolType) {
    console.log(`🔨 Спроба скрафтити ${toolType}...`);
    // Тут має бути повна логіка крафту (дерево -> дошки -> палиці -> інструмент)
    // Для прикладу спрощено:
    const recipes = bot.recipesFor(mcData.itemsByName[toolType].id, null, 1);
    if (recipes.length > 0) {
        await bot.craft(recipes[0], 1);
        bot.chat(`Скрафтив ${toolType}!`);
    } else {
        bot.chat(`Не вистачає ресурсів для ${toolType}. Йду видобувати дерево/каміння.`);
        // Логіка пошуку ресурсів...
    }
}

async function performAction(action) {
    if (isBusy) return;
    isBusy = true;

    try {
        await checkInventoryAndCraft(action);

        switch (action) {
            case 'mine':
                bot.chat("Йду видобувати ресурси...");
                // Логіка пошуку руди або дерева
                break;
            case 'build':
                bot.chat("Розбудовую базу...");
                // Логіка будівництва стін або даху
                break;
            case 'eat':
                const food = bot.inventory.items().find(i => i.foodRecovery > 0);
                if (food) {
                    await bot.equip(food, 'hand');
                    await bot.consume();
                    bot.chat("Смачно! Голод вгамовано.");
                } else {
                    bot.chat("Немає їжі! Терміново шукаю!");
                }
                break;
            case 'sleep':
                const bed = bot.findBlock({ matching: mcData.blocksByName.bed.id, range: 32 });
                if (bed) {
                    await bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 1));
                    await bot.sleep(bed);
                } else {
                    bot.chat("Немає ліжка поруч. Буду захищатися до ранку.");
                }
                break;
            case 'defend':
                bot.chat("До бою!");
                // Логіка бою вже обробляється в event 'physicsTick'
                break;
            case 'farm':
                bot.chat("Перевіряю ферму...");
                // Логіка збору врожаю
                break;
            default:
                bot.chat("Досліджую територію...");
                // Випадковий рух
                const x = Math.floor(bot.entity.position.x + (Math.random() - 0.5) * 20);
                const z = Math.floor(bot.entity.position.z + (Math.random() - 0.5) * 20);
                await bot.pathfinder.goto(new GoalXZ(x, z));
        }
    } catch (err) {
        console.error('Помилка виконання дії:', err);
        bot.chat("Щось пішло не так. Переплановую.");
    } finally {
        isBusy = false;
        scheduleNextTask();
    }
}

function scheduleNextTask() {
    setTimeout(async () => {
        const timeOfDay = bot.time.timeOfDay;
        const isNight = timeOfDay > 13000 || timeOfDay < 6000;
        
        let context = `Стан гравця: Здоров'я ${bot.health}, Голод ${bot.food}. Час: ${isNight ? 'Ніч' : 'День'}. `;
        
        if (bot.health < 10) context += "Критично низьке здоров'я! ";
        if (bot.food < 6) context += "Сильний голод. ";
        if (isNight) context += "На вулиці темно і небезпечно. ";
        
        context += "Що робити далі? (mine, build, craft, eat, sleep, defend, farm)";

        const decision = await askAI(context);
        await performAction(decision);
    }, 2000); // Пауза між діями
}

// --- ІНІЦІАЛІЗАЦІЯ ---
bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    password: CONFIG.password,
    viewDistance: 'normal'
});

bot.loadPlugin(pathfinder);

bot.on('spawn', () => {
    console.log(`✅ Бот спавнився. Версія: ${bot.version}`);
    mcData = require('minecraft-data')(bot.version);
    loadMemory();
    
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);
    
    bot.chat("Привіт! Я розумний бот з підтримкою ШІ. Запускаю аналіз ситуації...");
    scheduleNextTask();
});

// Бойова система
bot.on('physicsTick', () => {
    const entity = bot.nearestEntity(e => e.type === 'mob' && e.position.distanceTo(bot.entity.position) < 15);
    if (entity && ['zombie', 'skeleton', 'creeper'].includes(entity.name)) {
        if (!isBusy) {
            isBusy = true;
            bot.chat(`Атака ${entity.name}!`);
            const weapon = bot.inventory.items().find(i => i.name.includes('sword')) || bot.inventory.items().find(i => i.name.includes('axe'));
            if (weapon) bot.equip(weapon, 'hand');
            bot.pvp.attack(entity);
            
            const interval = setInterval(() => {
                if (!entity.isValid || entity.position.distanceTo(bot.entity.position) > 20) {
                    bot.pvp.stop();
                    isBusy = false;
                    clearInterval(interval);
                }
            }, 1000);
        }
    }
});

bot.on('error', err => console.error(err));