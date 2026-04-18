'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MobileMenu } from '../components/MobileMenu.jsx';
import { useAppContext } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fetchPublicReviews } from '../services/reviewService.js';

const GOOGLE_FEEDBACK_FORM_ACTION =
  'https://docs.google.com/forms/d/e/1FAIpQLSf9Sp9N6glz105wqomwfLVogWTgeit4Hdp5pjNnjHFWsC8MwA/formResponse';

const fallbackReviewCards = [
  {
    author: 'Jeevan P.',
    relativeTime: 'Google review',
    rating: 5,
    text: 'Guests highlight the taste, clean cooking, polite staff, and a warm atmosphere that feels made for family dinners.',
  },
  {
    author: 'Kandukuri N.',
    relativeTime: 'Google review',
    rating: 5,
    text: 'The location, quick service, and biryani are getting special praise from first-time diners and regulars alike.',
  },
  {
    author: 'Poojitha',
    relativeTime: 'Google review',
    rating: 5,
    text: 'Reviewers consistently call out flavorful biryani, fast service, and presentation that feels worth the visit.',
  },
  {
    author: 'Naveen Kumar',
    relativeTime: 'Google review',
    rating: 5,
    text: 'Comfortable seating, friendly staff, and quick turnaround are common reasons people recommend the restaurant.',
  },
];

const faqItems = [
  {
    question: 'Do you offer dine-in, takeaway, and delivery?',
    answer: 'Yes. Guests can dine in, pick up takeaway orders, or place delivery orders based on service availability.',
  },
  {
    question: 'How do table orders work inside the restaurant?',
    answer: 'Guests can browse the menu on their phone, then our waiter takes the final table order and sends it to the kitchen from the counter.',
  },
  {
    question: 'What are your opening hours?',
    answer: 'The restaurant serves daily from 11:45 AM to 11:00 PM.',
  },
  {
    question: 'What is the delivery radius?',
    answer: 'Delivery is available within 6 km of the restaurant. Orders outside that radius are automatically blocked during checkout.',
  },
  {
    question: 'Can I contact the restaurant for catering or large family orders?',
    answer: 'Yes. Use the contact numbers or the feedback form below to share your event size, date, and service needs.',
  },
];

export default function HomePage() {
  const { orderHistory } = useAppContext();
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [reviews, setReviews] = useState(fallbackReviewCards);
  const [reviewSummary, setReviewSummary] = useState({
    name: 'Bangaru Vakili Family Restaurant',
    rating: 4.9,
    userRatingCount: 69,
  });
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [feedback, setFeedback] = useState({
    name: '',
    phone: '',
    message: '',
  });
  const { showToast } = useToast();

  useEffect(() => {
    const handleResize = () => setDesktop(window.innerWidth >= 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  useEffect(() => {
    const loadReviews = async () => {
      try {
        setLoadingReviews(true);
        const data = await fetchPublicReviews();
        setReviews(data.reviews?.length ? data.reviews : fallbackReviewCards);
        setReviewSummary(
          data.summary || {
            name: 'Bangaru Vakili Family Restaurant',
            rating: 4.9,
            userRatingCount: 69,
          },
        );
      } catch {
        setReviews(fallbackReviewCards);
      } finally {
        setLoadingReviews(false);
      }
    };

    loadReviews();
  }, []);

  const handleFeedbackChange = (event) => {
    const { name, value } = event.target;
    setFeedback((current) => ({ ...current, [name]: value }));
  };

  const handleFeedbackSubmit = (event) => {
    event.preventDefault();

    if (!feedback.name.trim() || !feedback.message.trim()) {
      showToast('Please add your name and feedback message.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('entry.1274132306', feedback.name.trim());
    formData.append('entry.176930603', feedback.phone.trim());
    formData.append('entry.2138797335', feedback.message.trim());

    fetch(GOOGLE_FEEDBACK_FORM_ACTION, {
      method: 'POST',
      mode: 'no-cors',
      body: formData,
    })
      .then(() => {
        showToast('Feedback submitted. Thank you!', 'success');
        setFeedback({ name: '', phone: '', message: '' });
      })
      .catch(() => {
        showToast('Could not submit feedback right now.', 'error');
      });
  };

  return (
    <div>
      <nav className="navbar">
        <div className="nav-inner">
          <Link className="brand-link" href="/">
            <img alt="BVR Logo" className="brand-logo-img" src="/bvr-logo.png" />
          </Link>
          {desktop ? (
            <div className="desktop-nav">
              <Link className="nav-active" href="/">
                Home
              </Link>
              <Link href="/menu">Menu</Link>
              <a href="#about">About</a>
              <a href="#services">Services</a>
              <a href="#faq">FAQ</a>
              <a href="#feedback">Feedback</a>
              <a href="#contact">Contact</a>
              {!!orderHistory.length && <Link href="/status">Track Order</Link>}
              <Link href="/terms">Terms</Link>
            </div>
          ) : (
            <button aria-label="Open menu" className="hamburger" onClick={() => setOpen(true)} type="button">
              <span />
              <span />
              <span />
            </button>
          )}
        </div>
      </nav>

      <MobileMenu onClose={() => setOpen(false)} open={open} />

      <section className="hero-bg">
        <div className="hero-logo-wrap fade-up">
          <img alt="BVR Bangaru Vakili Family Restaurant" className="hero-logo-img" src="/bvr-logo.png" />
        </div>
        <h1 className="fade-up fade-delay-1 hero-title">Bangaru Vakili</h1>
        <p className="fade-up fade-delay-1 hero-subtitle">Family Restaurant - Nalgonda</p>
        <p className="fade-up fade-delay-2 hero-tagline">
          <em>&quot;Authentic Taste. Royal Experience.&quot;</em>
        </p>
        <p className="fade-up fade-delay-2 hero-est">Est. 2025</p>
        <p className="fade-up fade-delay-2 hero-copy">Welcome to our family. Experience the authentic flavors of South India.</p>
        <Link className="btn-gold fade-up fade-delay-3" href="/menu">
          Start Ordering
        </Link>
        {!!orderHistory.length && (
          <Link className="review-link fade-up fade-delay-3" href="/status" style={{ marginTop: 12 }}>
            Track Existing Order
          </Link>
        )}
        <p className="fade-up fade-delay-4 hero-note">Browse in-restaurant menus, or place outside delivery orders online - Also available on Pickzy</p>
      </section>

      <section className="section" id="about">
        <h2 className="section-title">About Us</h2>
        <div className="about-card-centered">
          <p className="about-description-large">
            At Bangaru Vakili Family Restaurant, we bring you a perfect blend of tradition and taste. Experience premium dining with authentic recipes, quality ingredients, and warm hospitality. We are committed to serving delicious food with excellence.
          </p>
        </div>

        <h2 className="section-title" id="services" style={{ marginTop: '48px' }}>
          Our Services
        </h2>
        <div className="services-scroll">
          <div className="service-card">
            <div className="service-icon">{'\u{1F37D}\uFE0F'}</div>
            <h3>Dine-In</h3>
            <p>Browse the menu on your phone while our waiter places and updates the table order for you.</p>
          </div>
          <div className="service-card">
            <div className="service-icon">{'\u{1F961}'}</div>
            <h3>Takeaway</h3>
            <p>Pack your favorites and enjoy them wherever you go.</p>
          </div>
          <div className="service-card">
            <div className="service-icon">{'\u{1F6F5}'}</div>
            <h3>Home Delivery</h3>
            <p>Order from anywhere, and we deliver to your door.</p>
          </div>
          <div className="service-card">
            <div className="service-icon">{'\u{1F3E0}'}</div>
            <h3>Indoor Catering</h3>
            <p>Premium catering for private events and celebrations.</p>
          </div>
          <div className="service-card">
            <div className="service-icon">{'\u{1F3AA}'}</div>
            <h3>Outdoor Catering</h3>
            <p>Events, functions, and large party catering service.</p>
          </div>
        </div>

        <div className="about-showcase">
          <div className="about-copy-card">
            <span className="about-kicker">Why Choose Us</span>
            <h3 className="about-title">Loved in Nalgonda for biryani, hospitality, and family dining.</h3>
            <p className="about-description">
              Bangaru Vakili Family Restaurant brings together South Indian favorites, rich biryani plates, warm service, and a comfortable dine-in space right near Shivaji Nagar Circle, Nalgonda.
            </p>
            <div className="about-highlights">
              <div>
                <strong>{reviewSummary.rating}/5</strong>
                <span>Google review rating snapshot</span>
              </div>
              <div>
                <strong>{reviewSummary.userRatingCount}+</strong>
                <span>Customer reviews surfaced publicly</span>
              </div>
              <div>
                <strong>11:45 AM - 11 PM</strong>
                <span>Daily service window</span>
              </div>
            </div>
          </div>

          <div className="about-map-card">
            <div className="map-card-header">
              <div>
                <span className="about-kicker">Visit Us</span>
                <h3 className="map-card-title">Shivaji Nagar Circle, Nalgonda - 508801</h3>
              </div>
              <a className="review-link" href="https://maps.app.goo.gl/n9FMSQ9tQxgsFgCC8" rel="noreferrer" target="_blank">
                Review Us
              </a>
            </div>
            <div className="map-frame-wrap">
              <iframe
                className="map-frame"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src="https://www.google.com/maps?q=Bangaru%20Vakili%20Family%20Restaurant%20Nalgonda&output=embed"
                title="Bangaru Vakili Family Restaurant Map"
              />
            </div>
          </div>
        </div>

        <div className="reviews-showcase">
          <div className="reviews-header">
            <div>
              <span className="about-kicker">Guest Reviews</span>
              <h3 className="reviews-title">What diners keep saying about BVR</h3>
            </div>
            <a className="review-link secondary" href="https://maps.app.goo.gl/n9FMSQ9tQxgsFgCC8" rel="noreferrer" target="_blank">
              Open Maps
            </a>
          </div>

          <div className="review-summary-bar">
            <div className="review-brand">
              <img alt="BVR" className="brand-logo-img-small" src="/bvr-logo.png" />
              <div>
                <h4>{reviewSummary.name}</h4>
                <p>Shivaji Nagar Circle, Nalgonda</p>
              </div>
            </div>
            <div className="review-score">
              <strong>{reviewSummary.rating}</strong>
              <span>★★★★★</span>
              <p>Based on {reviewSummary.userRatingCount}+ public reviews</p>
            </div>
          </div>

          <div className="reviews-scroll">
            {loadingReviews
              ? Array.from({ length: 4 }).map((_, index) => (
                  <article className="review-card" key={`review-skeleton-${index}`}>
                    <div className="skeleton-line mid" />
                    <div className="skeleton-line wide" />
                    <div className="skeleton-line wide" />
                    <div className="skeleton-line mid" />
                  </article>
                ))
              : reviews.map((review) => (
                  <article className="review-card" key={`${review.author}-${review.relativeTime}`}>
                    <div className="review-stars">{'★'.repeat(review.rating || 5)}</div>
                    <p className="review-text">{review.text}</p>
                    <div className="review-footer">
                      <div className="review-avatar">{review.author.charAt(0)}</div>
                      <div>
                        <strong>{review.author}</strong>
                        <span>{review.relativeTime}</span>
                      </div>
                    </div>
                  </article>
                ))}
          </div>
        </div>

        <div className="faq-feedback-grid">
          <section className="faq-panel" id="faq">
            <div className="reviews-header">
              <div>
                <span className="about-kicker">FAQ</span>
                <h3 className="reviews-title">Answers guests usually need before they visit</h3>
              </div>
            </div>

            <div className="faq-list">
              {faqItems.map((item, index) => {
                const isOpen = openFaq === index;
                return (
                  <article className={`faq-item ${isOpen ? 'open' : ''}`} key={item.question}>
                    <button className="faq-button" onClick={() => setOpenFaq(isOpen ? -1 : index)} type="button">
                      <span>{item.question}</span>
                      <span className="faq-symbol">{isOpen ? '-' : '+'}</span>
                    </button>
                    {isOpen && <p className="faq-answer">{item.answer}</p>}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="feedback-panel" id="feedback">
            <div className="reviews-header">
              <div>
                <span className="about-kicker">Feedback</span>
                <h3 className="reviews-title">Share a suggestion, catering request, or dining experience</h3>
              </div>
              <a className="review-link secondary" href="https://maps.app.goo.gl/n9FMSQ9tQxgsFgCC8" rel="noreferrer" target="_blank">
                Leave Public Review
              </a>
            </div>

            <form className="feedback-form" onSubmit={handleFeedbackSubmit}>
              <div className="feedback-fields">
                <input className="input-field" name="name" onChange={handleFeedbackChange} placeholder="Your name" type="text" value={feedback.name} />
                <input className="input-field" maxLength={10} name="phone" onChange={handleFeedbackChange} placeholder="Phone number (optional)" type="tel" value={feedback.phone} />
              </div>
              <textarea
                className="feedback-textarea"
                name="message"
                onChange={handleFeedbackChange}
                placeholder="Tell us about your experience, a menu request, or what we can improve."
                rows="6"
                value={feedback.message}
              />
              <div className="feedback-actions">
                <button className="btn-gold" type="submit">
                  Send Feedback
                </button>
                <a className="review-link secondary" href="tel:7337334474">
                  Call Restaurant
                </a>
              </div>
            </form>
          </section>
        </div>
      </section>

      <section className="info-strip" id="contact">
        <div className="info-row">
          <div className="info-item">
            <span className="info-icon">📍</span>
            <span>Shivaji Nagar Circle, Nalgonda - 508801</span>
          </div>
          <div className="info-item">
            <span className="info-icon">📞</span>
            <span>
              <a href="tel:7337334474">7337334474</a> - <a href="tel:9701054013">9701054013</a> - <a href="tel:9505523839">9505523839</a>
            </span>
          </div>
          <div className="info-item">
            <span className="info-icon">✉️</span>
            <a href="mailto:bangaruvakili2025@gmail.com">bangaruvakili2025@gmail.com</a>
          </div>
          <div className="info-item">
            <span className="info-icon">🕐</span>
            <span>Open: 11:45 AM - 11:00 PM</span>
          </div>
          <div className="info-item">
            <span className="info-icon">👤</span>
            <span>Prop: Punnam Nagaraju</span>
          </div>
        </div>
      </section>

      <footer className="footer">
        <p>Copyright (c) 2025 BVR Bangaru Vakili Family Restaurant. All rights reserved.</p>
        <p className="footer-links">
          <Link href="/terms">Terms &amp; Conditions</Link>
          <span>·</span>
          <a href="/BVR_Terms_and_Conditions.pdf" target="_blank" rel="noreferrer">
            View PDF
          </a>
        </p>
        <p>Powered by BVR Digital</p>
      </footer>
    </div>
  );
}
