// Typewriter Effect
const phrases = [
    'Web Developer',
    'HTML/CSS Expert',
    'JavaScript Developer',
    'NASA Space Apps Local Winner',
    'Frontend Specialist',
    'AI Enthusiast',
    'Open Source Contributor',
    'Blockchain Explorer',

];

let phraseIndex = 0;
let charIndex = 0;
let isDeleting = false;
const typewriter = document.getElementById('typewriter');

function type() {
    const currentPhrase = phrases[phraseIndex];
    
    if (isDeleting) {
        typewriter.textContent = currentPhrase.substring(0, charIndex - 1);
        charIndex--;
    } else {
        typewriter.textContent = currentPhrase.substring(0, charIndex + 1);
        charIndex++;
    }
    
    let typingSpeed = isDeleting ? 50 : 100;
    
    if (!isDeleting && charIndex === currentPhrase.length) {
        typingSpeed = 2000;
        isDeleting = true;
    } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        typingSpeed = 500;
    }
    
    setTimeout(type, typingSpeed);
}

type();

// Code Particles
const codeSnippets = [
    '<div>',
    '</div>',
    'const',
    'function',
    '{ }',
    '[ ]',
    '=>',
    'class',
    '#id',
    '.class',
    'async',
    'await',
    'HTML',
    'CSS',
    'JS',
    'React',
    'Vue',
    'Angular',
    'Node.js',
    'Python',
    'Java',
    'C++',
    'PHP',
    
];

function createParticle() {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.textContent = codeSnippets[Math.floor(Math.random() * codeSnippets.length)];
    particle.style.left = Math.random() * 100 + '%';
    particle.style.animationDelay = Math.random() * 10 + 's';
    particle.style.fontSize = Math.random() * 10 + 14 + 'px';
    document.getElementById('particles').appendChild(particle);
    
    setTimeout(() => particle.remove(), 10000);
}

// Create initial particles
for (let i = 0; i < 20; i++) {
    setTimeout(() => createParticle(), i * 500);
}

// Continue creating particles
setInterval(createParticle, 1000);

// Navbar Scroll Effect and Scroll Indicator
window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    const scrollIndicator = document.querySelector('.scroll-indicator');
    const scrollPosition = window.scrollY;
    
    // Navbar effect
    if (scrollPosition > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
    
    // Hide scroll indicator when scrolling
    if (scrollIndicator) {
        if (scrollPosition > 10) {
            scrollIndicator.style.opacity = '0';
            scrollIndicator.style.pointerEvents = 'none';
        } else {
            scrollIndicator.style.opacity = '';
            scrollIndicator.style.pointerEvents = '';
        }
    }
});

// Mouse Move Gradient Effect
document.addEventListener('mousemove', (e) => {
    const gradient = document.querySelector('.gradient-bg');
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    
    gradient.style.transform = `translate(${x * 20 - 10}px, ${y * 20 - 10}px)`;
});

// Skill Tabs Filter
const skillTabs = document.querySelectorAll('.skill-tab');
const skillCards = document.querySelectorAll('.skill-card');

skillTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        // Update active tab
        skillTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Filter skills
        const category = tab.getAttribute('data-category');
        
        skillCards.forEach(card => {
            if (category === 'all' || card.getAttribute('data-category') === category) {
                card.style.display = 'block';
                setTimeout(() => {
                    card.style.opacity = '1';
                    card.style.transform = 'scale(1)';
                }, 100);
            } else {
                card.style.opacity = '0';
                card.style.transform = 'scale(0.8)';
                setTimeout(() => {
                    card.style.display = 'none';
                }, 300);
            }
        });
    });
});

// Animate skill cards on scroll
function animateSkillCards() {
    const cards = document.querySelectorAll('.skill-card');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }, index * 100);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.2 });
    
    cards.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = 'all 0.5s ease';
        observer.observe(card);
        
        // Add 3D hover effect
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const rotateX = (y - centerY) / 10;
            const rotateY = (centerX - x) / 10;
            
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-10px) scale(1.05)`;
        });
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) translateY(0) scale(1)';
        });
    });
}

animateSkillCards();

// Timeline Animation
function animateTimeline() {
    const timelineItems = document.querySelectorAll('.timeline-item');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('show');
            }
        });
    }, { threshold: 0.2 });
    
    timelineItems.forEach(item => {
        observer.observe(item);
    });
}

animateTimeline();

// Contact Form Handler
document.getElementById('contactForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    // Get form data
    const formData = {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        message: document.getElementById('message').value
    };
    
    // Here you would normally send the data to a server
    console.log('Form submitted:', formData);
    
    // Show success message
    const button = this.querySelector('.form-submit');
    const originalText = button.textContent;
    button.textContent = 'Message Sent! ✓';
    button.style.background = 'linear-gradient(135deg, #10b981, #6366f1)';
    
    // Reset form
    this.reset();
    
    // Reset button after 3 seconds
    setTimeout(() => {
        button.textContent = originalText;
        button.style.background = '';
    }, 3000);
});

// Smooth Scroll for Navigation Links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Scroll indicator click to next section
const scrollIndicator = document.querySelector('.scroll-indicator');
if (scrollIndicator) {
    scrollIndicator.addEventListener('click', () => {
        const projectsSection = document.getElementById('projects');
        if (projectsSection) {
            projectsSection.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
}

// Mobile Menu Toggle
const menuToggle = document.getElementById('menuToggle');
const navLinks = document.querySelector('.nav-links');

menuToggle.addEventListener('click', () => {
    navLinks.classList.toggle('active');
    menuToggle.classList.toggle('active');
});

// Parallax Effect for Hero
window.addEventListener('scroll', () => {
    const scrolled = window.pageYOffset;
    const heroContent = document.querySelector('.hero-content');
    const particles = document.querySelector('.code-particles');
    const heroBg = document.querySelector('.hero-bg');
    
    if (heroContent && scrolled < window.innerHeight) {
        heroContent.style.transform = `translateY(${scrolled * 0.5}px)`;
        heroContent.style.opacity = 1 - scrolled / 800;
    }
    
    if (particles && scrolled < window.innerHeight) {
        particles.style.transform = `translateY(${scrolled * 0.3}px)`;
    }
    
    // Fade out background effect after scrolling past hero
    if (heroBg) {
        if (scrolled > window.innerHeight) {
            heroBg.style.opacity = '0';
            heroBg.style.visibility = 'hidden';
        } else {
            heroBg.style.opacity = '1';
            heroBg.style.visibility = 'visible';
        }
    }
});