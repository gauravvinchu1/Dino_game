/**
 * Dino Hunter: Survival
 * A vanilla JS top-down survival game.
 */

// --- Configuration & Constants ---
const CONFIG = {
    SPAWN_INTERVAL: 1500, // ms
    INITIAL_ENEMY_COUNT: 5,
    MAX_ENEMIES: 30,
    PLAYER_BASE_SPEED: 4,
    GROWTH_FACTOR: 0.2, // How much size increases per kill
    DIFFICULTY_SCALING_RATE: 0.05, // Increase spawn rate/speed over time
    COLOR_PALETTE: {
        BACKGROUND: '#1a2412', // Dark jungle green
        PLAYER: '#3b82f6', // Blue
        SMALL_DINO: '#84cc16', // Lime green
        MEDIUM_DINO: '#84cc16',
        LARGE_DINO: '#7f1d1d'  // Dark red
    }
};

// --- Audio Manager (Web Audio API) ---
class AudioManager {
    constructor() {
        this.ctx = null;
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    playEatSound() {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.1);
        
        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start();
        osc.stop(this.ctx.currentTime + 0.2);
    }

    playGameOverSound() {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(40, this.ctx.currentTime + 0.8);
        
        gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 1.0);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start();
        osc.stop(this.ctx.currentTime + 1.0);
    }
}

const audio = new AudioManager();

// --- Dinosaur Drawing Utility ---
function drawDino(ctx, x, y, size, angle, color, isPlayer = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Body (Ellipse)
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 1.2, size * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tail
    ctx.beginPath();
    ctx.moveTo(-size * 1.1, 0);
    ctx.lineTo(-size * 2.2, size * 0.3 * Math.sin(Date.now() / 200 + size));
    ctx.lineTo(-size * 1.0, -size * 0.3);
    ctx.fill();

    // Head
    ctx.beginPath();
    ctx.ellipse(size * 1.0, -size * 0.4, size * 0.6, size * 0.5, 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.lineWidth = size * 0.2;
    ctx.strokeStyle = color;
    const legSwing = Math.sin(Date.now() / 100) * 0.3;
    
    // Front legs
    ctx.beginPath(); ctx.moveTo(size * 0.5, size * 0.5); ctx.lineTo(size * (0.5 + legSwing), size * 1.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(size * 0.5, -size * 0.5); ctx.lineTo(size * (0.5 - legSwing), -size * 1.2); ctx.stroke();
    
    // Back legs
    ctx.beginPath(); ctx.moveTo(-size * 0.5, size * 0.5); ctx.lineTo(-size * (0.5 - legSwing), size * 1.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-size * 0.5, -size * 0.5); ctx.lineTo(-size * (0.5 + legSwing), -size * 1.2); ctx.stroke();

    // Eye
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(size * 1.2, -size * 0.5, size * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'black';
    ctx.beginPath();
    ctx.arc(size * 1.25, -size * 0.5, size * 0.08, 0, Math.PI * 2);
    ctx.fill();

    // Features if player
    if (isPlayer) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    ctx.restore();
}

// --- Base Entity Class ---
class Entity {
    constructor(x, y, size, color) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.color = color;
        this.angle = 0;
        this.vx = 0;
        this.vy = 0;
    }

    update(canvas) {
        this.x += this.vx;
        this.y += this.vy;

        // Keep in bounds
        if (this.x < -this.size * 2) this.x = canvas.width + this.size * 2;
        if (this.x > canvas.width + this.size * 2) this.x = -this.size * 2;
        if (this.y < -this.size * 2) this.y = canvas.height + this.size * 2;
        if (this.y > canvas.height + this.size * 2) this.y = -this.size * 2;

        if (this.vx !== 0 || this.vy !== 0) {
            this.angle = Math.atan2(this.vy, this.vx);
        }
    }

    draw(ctx) {
        drawDino(ctx, this.x, this.y, this.size, this.angle, this.color);
    }
}

// --- Player Class ---
class Player extends Entity {
    constructor(x, y) {
        super(x, y, 20, CONFIG.COLOR_PALETTE.PLAYER);
        this.score = 0;
        this.targetSize = 20;
    }

    update(canvas, keys, joystick) {
        let dx = 0;
        let dy = 0;

        if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
        if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
        if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
        if (keys['KeyD'] || keys['ArrowRight']) dx += 1;

        // Joystick support
        if (joystick.active) {
            dx = joystick.x;
            dy = joystick.y;
        }

        // Normalize speed
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
            const speed = CONFIG.PLAYER_BASE_SPEED * (20 / this.size) ** 0.3; // Get slower as you grow
            this.vx = (dx / dist) * speed;
            this.vy = (dy / dist) * speed;
        } else {
            this.vx *= 0.9;
            this.vy *= 0.9;
        }

        super.update(canvas);
        
        // Smooth growth
        if (this.size < this.targetSize) {
            this.size += 0.1;
        }
    }

    draw(ctx) {
        drawDino(ctx, this.x, this.y, this.size, this.angle, this.color, true);
    }

    eat(enemy) {
        this.score += Math.floor(enemy.size);
        this.targetSize += CONFIG.GROWTH_FACTOR;
        audio.playEatSound();
    }
}

// --- Enemy Class ---
class Enemy extends Entity {
    constructor(x, y, size, color, speed) {
        super(x, y, size, color);
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.speed = speed;
        this.changeDirTimer = Math.random() * 2000 + 1000;
    }

    update(canvas, player, deltaTime) {
        super.update(canvas);

        // Simple AI: Wiggle or chase/flee
        this.changeDirTimer -= deltaTime;
        if (this.changeDirTimer <= 0) {
            const angleVar = (Math.random() - 0.5) * 0.5;
            const currentAngle = Math.atan2(this.vy, this.vx);
            const newAngle = currentAngle + angleVar;
            this.vx = Math.cos(newAngle) * this.speed;
            this.vy = Math.sin(newAngle) * this.speed;
            this.changeDirTimer = Math.random() * 2000 + 1000;
        }

        // Optional: Big ones chase player slightly
        if (this.size > player.size * 1.2) {
            const dx = player.x - this.x;
            const dy = player.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 400) {
                this.vx += (dx / dist) * 0.05;
                this.vy += (dy / dist) * 0.05;
                const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                if (speed > this.speed * 1.5) {
                    this.vx = (this.vx / speed) * this.speed * 1.5;
                    this.vy = (this.vy / speed) * this.speed * 1.5;
                }
            }
        }
    }
}

// --- Game Manager ---
class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.player = null;
        this.enemies = [];
        this.keys = {};
        this.joystick = { x: 0, y: 0, active: false };
        this.gameState = 'START'; // START, PLAYING, GAMEOVER
        this.lastTime = 0;
        this.spawnTimer = 0;
        this.difficulty = 1;
        
        this.setupListeners();
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    setupListeners() {
        window.addEventListener('keydown', (e) => this.keys[e.code] = true);
        window.addEventListener('keyup', (e) => this.keys[e.code] = false);

        document.getElementById('start-button').addEventListener('click', () => this.start());
        document.getElementById('restart-button').addEventListener('click', () => this.start());

        // Touch handling
        const joystickBase = document.getElementById('joystick-base');
        const joystickKnob = document.getElementById('joystick-knob');
        const touchArea = document.getElementById('touch-controls');

        const handleTouch = (e) => {
            if (this.gameState !== 'PLAYING') return;
            e.preventDefault();
            const touch = e.touches[0];
            const rect = joystickBase.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            let dx = touch.clientX - centerX;
            let dy = touch.clientY - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxDist = rect.width / 2;

            if (dist > maxDist) {
                dx = (dx / dist) * maxDist;
                dy = (dy / dist) * maxDist;
            }

            this.joystick.x = dx / maxDist;
            this.joystick.y = dy / maxDist;
            this.joystick.active = true;

            joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        };

        const endTouch = () => {
            this.joystick.active = false;
            this.joystick.x = 0;
            this.joystick.y = 0;
            joystickKnob.style.transform = `translate(0px, 0px)`;
        };

        joystickBase.addEventListener('touchstart', (e) => {
            handleTouch(e);
            audio.init(); // Initialize audio on user interaction
        });
        joystickBase.addEventListener('touchmove', handleTouch);
        joystickBase.addEventListener('touchend', endTouch);
        
        // Show touch controls if it's likely a touch device
        if ('ontouchstart' in window) {
            touchArea.classList.remove('hidden');
        }
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    start() {
        audio.init();
        this.player = new Player(this.canvas.width / 2, this.canvas.height / 2);
        this.enemies = [];
        this.score = 0;
        this.difficulty = 1;
        this.gameState = 'PLAYING';
        
        // Initial spawn
        for (let i = 0; i < CONFIG.INITIAL_ENEMY_COUNT; i++) {
            this.spawnEnemy();
        }

        document.getElementById('start-screen').classList.remove('active');
        document.getElementById('game-over-screen').classList.remove('active');
        
        requestAnimationFrame((t) => this.loop(t));
    }

    spawnEnemy() {
        const side = Math.floor(Math.random() * 4);
        let x, y;
        const padding = 100;

        if (side === 0) { x = Math.random() * this.canvas.width; y = -padding; }
        else if (side === 1) { x = this.canvas.width + padding; y = Math.random() * this.canvas.height; }
        else if (side === 2) { x = Math.random() * this.canvas.width; y = this.canvas.height + padding; }
        else { x = -padding; y = Math.random() * this.canvas.height; }

        // Size based on player size and difficulty
        const minSize = Math.max(10, this.player.size * 0.5);
        const maxSize = this.player.size * 1.5 * this.difficulty;
        const size = Math.random() * (maxSize - minSize) + minSize;

        let color = CONFIG.COLOR_PALETTE.SMALL_DINO;
        if (size > this.player.size * 1.3) color = CONFIG.COLOR_PALETTE.LARGE_DINO;
        else if (size > this.player.size) color = CONFIG.COLOR_PALETTE.MEDIUM_DINO;

        const speed = (Math.random() * 2 + 1) * this.difficulty;
        this.enemies.push(new Enemy(x, y, size, color, speed));
    }

    gameOver() {
        this.gameState = 'GAMEOVER';
        audio.playGameOverSound();
        
        const highScore = localStorage.getItem('dino_highscore') || 0;
        if (this.player.score > highScore) {
            localStorage.setItem('dino_highscore', this.player.score);
        }

        document.getElementById('final-score').textContent = this.player.score;
        document.getElementById('high-score').textContent = Math.max(this.player.score, highScore);
        document.getElementById('game-over-screen').classList.add('active');
    }

    loop(time) {
        if (this.gameState !== 'PLAYING') return;

        const deltaTime = time - this.lastTime;
        this.lastTime = time;

        // Update State
        this.player.update(this.canvas, this.keys, this.joystick);
        
        this.difficulty += 0.0001; // Slow increase
        this.spawnTimer += deltaTime;
        if (this.spawnTimer > CONFIG.SPAWN_INTERVAL / this.difficulty && this.enemies.length < CONFIG.MAX_ENEMIES) {
            this.spawnEnemy();
            this.spawnTimer = 0;
        }

        this.enemies.forEach((enemy, index) => {
            enemy.update(this.canvas, this.player, deltaTime);

            // Collision Check
            const dx = enemy.x - this.player.x;
            const dy = enemy.y - this.player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < (this.player.size + enemy.size) * 0.8) {
                if (this.player.size > enemy.size) {
                    // Eat
                    this.player.eat(enemy);
                    this.enemies.splice(index, 1);
                } else {
                    // Die
                    this.gameOver();
                }
            }
        });

        // Update UI
        document.getElementById('score-value').textContent = String(this.player.score).padStart(3, '0');
        const level = Math.floor(this.player.size / 15);
        document.getElementById('size-value').textContent = `Lv ${level}`;

        // Draw
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw some "floor" details for sense of movement
        this.drawBackground();

        this.enemies.forEach(enemy => enemy.draw(this.ctx));
        this.player.draw(this.ctx);

        requestAnimationFrame((t) => this.loop(t));
    }

    drawBackground() {
        // Draw some "floor" details for sense of movement
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        this.ctx.lineWidth = 1;
        const spacing = 150;
        
        const offsetX = -this.player.x % spacing;
        const offsetY = -this.player.y % spacing;

        // Grid
        for (let x = offsetX; x < this.canvas.width; x += spacing) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }
        for (let y = offsetY; y < this.canvas.height; y += spacing) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }

        // Decorative elements (fixed positions relative to world)
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        const decorations = [
            { x: 200, y: 300, type: 'rock' },
            { x: 800, y: 150, type: 'plant' },
            { x: 1200, y: 600, type: 'rock' },
            { x: 500, y: 800, type: 'plant' },
            { x: 1500, y: 200, type: 'rock' },
            { x: 100, y: 700, type: 'plant' }
        ];

        decorations.forEach(d => {
            // Repeat decoration every 2000px
            const worldSize = 2000;
            const dx = ((d.x - this.player.x) % worldSize + worldSize) % worldSize - worldSize/2 + this.canvas.width/2;
            const dy = ((d.y - this.player.y) % worldSize + worldSize) % worldSize - worldSize/2 + this.canvas.height/2;

            if (d.type === 'rock') {
                this.ctx.beginPath();
                this.ctx.arc(dx, dy, 15, 0, Math.PI * 2);
                this.ctx.fill();
            } else {
                this.ctx.beginPath();
                this.ctx.moveTo(dx, dy);
                this.ctx.lineTo(dx + 10, dy - 20);
                this.ctx.lineTo(dx - 10, dy - 20);
                this.ctx.fill();
            }
        });
    }
}

// Start Game Instance
window.onload = () => {
    new Game();
};
