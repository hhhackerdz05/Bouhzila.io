// --- منطق لعبة البوحزيلة (Bouhzila.io) ---

class Player {
    constructor(id, ws) {
        this.id = id;
        this.ws = ws;
        this.name = 'Anonymous';
        this.x = Math.random() * 3000; // موقع عشوائي مبدئي
        this.y = Math.random() * 3000;
        this.score = 10;
        this.r = 10; // نصف القطر بناءً على الدرجة
        this.speed = 4;
        this.color = this.getRandomColor();
        this.targetX = this.x;
        this.targetY = this.y;
    }

    // توليد لون عشوائي
    getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    // تحديث نصف القطر بناءً على الدرجة
    updateRadius() {
        this.r = 10 + Math.sqrt(this.score) * 2;
        // ضمان ألا يصبح نصف القطر صغيراً جداً
        if (this.r < 10) this.r = 10;
    }
}

class Food {
    constructor(id) {
        this.id = id;
        this.x = Math.random() * 3000;
        this.y = Math.random() * 3000;
        this.r = 3;
        this.color = this.getRandomColor();
        this.value = 1;
    }
    
    // توليد لون عشوائي للطعام
    getRandomColor() {
        const colors = ['#FF6F61', '#6B5B95', '#88B04B', '#FFD700', '#F7CAC9'];
        return colors[Math.floor(Math.random() * colors.length)];
    }
}

class Game {
    constructor() {
        this.players = [];
        this.food = [];
        this.world = { width: 3000, height: 3000 };
        this.foodCount = 200; // الهدف من عدد قطع الطعام
        this.lastUpdateTime = performance.now();
        this.nextPlayerId = 1;
        this.nextFoodId = 1;

        this.initFood();
    }

    // إضافة قطع الطعام الأولية
    initFood() {
        for (let i = 0; i < this.foodCount; i++) {
            this.food.push(new Food(this.nextFoodId++));
        }
    }

    // إضافة لاعب جديد
    addPlayer(ws) {
        const id = this.nextPlayerId++;
        const newPlayer = new Player(id, ws);
        this.players.push(newPlayer);
        
        // إرسال معلومات التهيئة إلى اللاعب
        ws.send(JSON.stringify({ 
            type: 'init', 
            id: id, 
            world: this.world 
        }));
    }

    // إزالة لاعب
    removePlayer(ws) {
        this.players = this.players.filter(p => p.ws !== ws);
    }

    // إرسال حالة اللعبة الحالية إلى جميع اللاعبين
    broadcastState() {
        const state = {
            players: this.players.map(p => ({
                id: p.id,
                x: p.x,
                y: p.y,
                r: p.r,
                name: p.name,
                color: p.color,
                score: p.score
            })),
            food: this.food
        };

        const stateString = JSON.stringify(state);

        this.players.forEach(p => {
            if (p.ws.readyState === 1) { // WebSocket.OPEN
                p.ws.send(stateString);
            }
        });
    }

    // تحريك اللاعب بناءً على الهدف (الماوس)
    movePlayer(player, deltaTime) {
        const dx = player.targetX - player.x;
        const dy = player.targetY - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 1) { // Move only if target is not reached
            const angle = Math.atan2(dy, dx);
            // السرعة تعتمد على الدرجة (كلما زادت الدرجة، قلت السرعة)
            const currentSpeed = player.speed * (15 / player.r); 
            const moveDistance = currentSpeed * deltaTime;

            // ضمان عدم تجاوز المسافة
            const finalMoveDistance = Math.min(moveDistance, distance);

            player.x += Math.cos(angle) * finalMoveDistance;
            player.y += Math.sin(angle) * finalMoveDistance;

            // تحديد حدود العالم
            player.x = Math.max(player.r, Math.min(this.world.width - player.r, player.x));
            player.y = Math.max(player.r, Math.min(this.world.height - player.r, player.y));
        }
    }

    // التحقق من التصادم بين لاعب والطعام
    checkFoodCollision(player) {
        this.food = this.food.filter(foodItem => {
            const dx = foodItem.x - player.x;
            const dy = foodItem.y - player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < player.r) {
                // تم أكل الطعام
                player.score += foodItem.value;
                player.updateRadius();
                return false; // إزالة الطعام من المصفوفة
            }
            return true; // الاحتفاظ بالطعام
        });

        // تجديد قطع الطعام المفقودة
        while (this.food.length < this.foodCount) {
            this.food.push(new Food(this.nextFoodId++));
        }
    }
    
    // التحقق من تصادم اللاعبين (هنا يتم تطبيق منطق أكل اللاعبين)
    checkPlayerCollision() {
        // يتم استخدام حلقة مزدوجة لتجنب تكرار التحقق
        for (let i = 0; i < this.players.length; i++) {
            const p1 = this.players[i];
            for (let j = i + 1; j < this.players.length; j++) {
                const p2 = this.players[j];

                // التحقق من التصادم بين p1 و p2
                const dx = p1.x - p2.x;
                const dy = p1.y - p2.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // إذا تداخلت الدوائر (نصف القطر مجموع)
                if (distance < p1.r + p2.r) { 
                    // إذا كان الفرق في نصف القطر كافياً (لضمان أن اللاعب الأكبر هو الذي يأكل)
                    const overlap = (p1.r + p2.r) - distance;
                    
                    if (p1.r > p2.r * 1.1) { // p1 أكبر بكثير من p2 (بنسبة 10% مثلاً)
                        // p1 يأكل p2 جزئياً أو كلياً
                        p1.score += p2.score * 0.5; // p1 يكسب نصف درجة p2
                        p1.updateRadius();
                        
                        // إرسال رسالة قطع اتصال للاعب الذي تم أكله (p2)
                        if (p2.ws.readyState === 1) {
                            p2.ws.send(JSON.stringify({ type: 'dead', message: `تم أكلك بواسطة ${p1.name}` }));
                            p2.ws.close();
                        }
                    } else if (p2.r > p1.r * 1.1) { // p2 أكبر بكثير من p1
                        // p2 يأكل p1
                        p2.score += p1.score * 0.5;
                        p2.updateRadius();

                        // إرسال رسالة قطع اتصال للاعب الذي تم أكله (p1)
                        if (p1.ws.readyState === 1) {
                            p1.ws.send(JSON.stringify({ type: 'dead', message: `تم أكلك بواسطة ${p2.name}` }));
                            p1.ws.close();
                        }
                    }
                }
            }
        }
        // تنظيف قائمة اللاعبين الذين تم إغلاق اتصالهم بعد التصادم
        this.players = this.players.filter(p => p.ws.readyState !== 3); // 3 = CLOSED
    }
    
    // حلقة تحديث اللعبة الرئيسية
    update() {
        const now = performance.now();
        // دلتا تايم (الزمن المنقضي) مقسوماً على 1000 لتحويله إلى ثوانٍ
        const deltaTime = (now - this.lastUpdateTime) / 1000; 
        this.lastUpdateTime = now;

        this.players.forEach(player => {
            // 1. تحريك اللاعب
            this.movePlayer(player, deltaTime);

            // 2. التحقق من أكل الطعام
            this.checkFoodCollision(player);
        });
        
        // 3. التحقق من تصادم اللاعبين (يتم بعد تحديث مواقع اللاعبين)
        this.checkPlayerCollision();
        
        // 4. إرسال الحالة المحدثة إلى العملاء
        this.broadcastState();
    }
    
    // بدء حلقة اللعبة
    startGameLoop() {
        console.log('Game loop started.');
        // تشغيل التحديث بمعدل 30 مرة في الثانية (33.3ms)
        setInterval(() => this.update(), 1000 / 30); 
    }
}

module.exports = Game;
