'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FloatingCart } from '../components/FloatingCart.jsx';
import { useAppContext } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fetchPublicMenu } from '../services/menuService.js';
import { formatPrice, getCatEmoji } from '../utils/format.js';
import { getOpenMessage, isRestaurantOpen } from '../utils/restaurant.js';

export default function MenuPage() {
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode');
  const inRestaurantMode = mode === 'restaurant';
  const outsideMode = mode === 'outside';
  const viewOnly = inRestaurantMode;

  const { cart, setCart, orderHistory, restaurantStatus } = useAppContext();
  const { showToast } = useToast();
  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const open = isRestaurantOpen(restaurantStatus);

  useEffect(() => {
    const loadMenu = async () => {
      try {
        setLoading(true);
        const data = await fetchPublicMenu();
        setCategories(data.categories);
        setMenuItems(data.items);
        setError('');
      } catch {
        setError('Menu unavailable. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadMenu();
  }, []);

  const filteredItems = useMemo(() => {
    let items = selectedCategories.length
      ? menuItems.filter((item) => selectedCategories.includes(item.category))
      : menuItems;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      items = items.filter((item) => item.name.toLowerCase().includes(query));
    }

    return items;
  }, [menuItems, searchQuery, selectedCategories]);

  const showSectionedLayout = !selectedCategories.length && !searchQuery.trim();
  const getQty = (id) => cart.find((item) => item.id === id)?.quantity || 0;

  const updateCartItem = (menuItem, delta) => {
    if (viewOnly) return;

    setCart((previous) => {
      const existing = previous.find((item) => item.id === menuItem.id);
      if (!existing && delta < 0) {
        return previous;
      }

      if (existing) {
        return previous
          .map((item) => (item.id === menuItem.id ? { ...item, quantity: item.quantity + delta } : item))
          .filter((item) => item.quantity > 0);
      }

      return [...previous, { ...menuItem, quantity: 1 }];
    });

    if (delta > 0 && getQty(menuItem.id) === 0) {
      showToast(`${menuItem.name} added`);
    }
  };

  const toggleCategory = (categoryName) => {
    setSelectedCategories((current) =>
      current.includes(categoryName) ? current.filter((name) => name !== categoryName) : [...current, categoryName],
    );
  };

  const renderCard = (item) => {
    const qty = getQty(item.id);
    return (
      <div className="menu-card" key={item.id}>
        <div className="card-img-wrap">
          {item.imageUrl ? (
            <img alt={item.name} className="card-img" loading="lazy" src={item.imageUrl} />
          ) : (
            <div className="card-img-placeholder">{getCatEmoji(item.category)}</div>
          )}
          <span className="card-cat-badge">{item.category}</span>
        </div>
        <div className="card-body">
          <div className="card-name">{item.name}</div>
          <div className="card-price">{formatPrice(item.price)}</div>
          {viewOnly ? (
            <button className="add-btn" disabled type="button">
              Waiter Will Take Order
            </button>
          ) : qty === 0 ? (
            <button className="add-btn" disabled={!open} onClick={() => updateCartItem(item, 1)} type="button">
              {open ? '+ Add' : 'Paused'}
            </button>
          ) : (
            <div className="qty-row">
              <button className="qty-btn" disabled={!open} onClick={() => updateCartItem(item, -1)} type="button">
                -
              </button>
              <span className="qty-num">{qty}</span>
              <button className="qty-btn" disabled={!open} onClick={() => updateCartItem(item, 1)} type="button">
                +
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <nav className="navbar">
        <div className="nav-inner">
          <Link className="back-link" href="/">
            <span>&larr;</span>
            <span>Back</span>
          </Link>
          <h1 className="page-title">BVR Menu</h1>
          <div className="cart-icon-wrap">
            {!!orderHistory.length && (
              <Link aria-label="Track your order" className="cart-link" href="/status">
                Track Order
              </Link>
            )}
            {!viewOnly && outsideMode && (
              <>
                <Link aria-label="Go to cart" className="cart-link" href="/cart">
                  Cart
                </Link>
                {!!cart.length && <span className="cart-badge">{cart.reduce((sum, item) => sum + item.quantity, 0)}</span>}
              </>
            )}
          </div>
        </div>
      </nav>

      {!mode && (
        <main className="cart-main" style={{ paddingTop: 96 }}>
          <div className="cart-shell">
            <div className="card cart-card" style={{ textAlign: 'center' }}>
              <h2 className="card-title">How Would You Like To Use The Menu?</h2>
              <p className="muted-small" style={{ marginBottom: 18 }}>
                Choose whether you are inside the restaurant or placing an order from outside.
              </p>
              <div className="stacked-fields">
                <Link className="btn-gold inline-button" href="/menu?mode=restaurant">
                  Ordering In Restaurant
                </Link>
                <Link className="btn-gold inline-button" href="/menu?mode=outside">
                  Ordering Outside Restaurant
                </Link>
              </div>
            </div>
          </div>
        </main>
      )}

      {!!mode && !open && outsideMode && (
        <div className="closed-banner" style={{ marginTop: 64 }}>
          Orders unavailable. {getOpenMessage(restaurantStatus)}
        </div>
      )}

      {!!mode && inRestaurantMode && (
        <div className="closed-banner" style={{ marginTop: 64, background: '#1a0e00', borderBottomColor: '#d4a017', color: '#f5e6c8' }}>
          In-restaurant mode is browse only. Please call the waiter to place or add items to your table.
        </div>
      )}

      {!!mode && (
        <>
          <div className="tabs-wrap menu-toolbar" style={{ marginTop: outsideMode && open ? 64 : 0 }}>
            <button className={`filter-trigger-btn ${filtersOpen ? 'active' : ''}`} onClick={() => setFiltersOpen((value) => !value)} type="button">
              <span className="filter-trigger-icon">☰</span>
              <span>Filter</span>
              {!!selectedCategories.length && <span className="filter-count-badge">{selectedCategories.length}</span>}
            </button>
            <div className="category-chip-row">
              <button className={`tab-btn ${selectedCategories.length === 0 ? 'active' : ''}`} onClick={() => setSelectedCategories([])} type="button">
                All ({menuItems.length})
              </button>
              {categories.map((category) => {
                const count = menuItems.filter((item) => item.category === category.name).length;
                if (!count) return null;
                const active = selectedCategories.includes(category.name);
                return (
                  <button className={`tab-btn ${active ? 'active' : ''}`} key={category.id || category.name} onClick={() => toggleCategory(category.name)} type="button">
                    {getCatEmoji(category.name)} {category.name} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {filtersOpen && (
            <div className="filter-dropdown-wrap">
              <div className="filter-dropdown-card">
                <div className="selected-filter-head">
                  <span>Select categories</span>
                  <button className="clear-filter-btn" onClick={() => setSelectedCategories([])} type="button">
                    Clear all
                  </button>
                </div>
                <div className="filter-dropdown-list">
                  {categories.map((category) => {
                    const count = menuItems.filter((item) => item.category === category.name).length;
                    if (!count) return null;
                    const active = selectedCategories.includes(category.name);
                    return (
                      <button className={`filter-option-btn ${active ? 'active' : ''}`} key={category.id || category.name} onClick={() => toggleCategory(category.name)} type="button">
                        <span>{getCatEmoji(category.name)} {category.name}</span>
                        <span>{active ? 'Selected' : `${count} items`}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {!!selectedCategories.length && (
            <div className="selected-filter-wrap">
              <div className="selected-filter-head">
                <span>Selected Filters</span>
                <button className="clear-filter-btn" onClick={() => setSelectedCategories([])} type="button">
                  Clear all
                </button>
              </div>
              <div className="selected-filter-list">
                {selectedCategories.map((category) => (
                  <button className="selected-filter-chip" key={category} onClick={() => toggleCategory(category)} type="button">
                    {category} ×
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="search-wrap">
            <div className="search-inner">
              <span aria-hidden="true" className="search-icon">⌕</span>
              <input className="search-input" onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search dishes..." type="text" value={searchQuery} />
              {!!searchQuery && (
                <button aria-label="Clear search" className="search-clear" onClick={() => setSearchQuery('')} type="button">
                  ×
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="menu-grid menu-grid-top">
              {Array.from({ length: 6 }).map((_, index) => (
                <div className="skeleton-card" key={index}>
                  <div className="skeleton-img" />
                  <div className="skeleton-line wide" />
                  <div className="skeleton-line mid" />
                  <div className="skeleton-line buttonish" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="empty-state">
              <div className="empty-icon">!</div>
              <h3>Menu unavailable. Please try again.</h3>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">?</div>
              <h3>No results found</h3>
              <p>No dishes match your current filters.</p>
            </div>
          ) : showSectionedLayout ? (
            categories.map((category) => {
              const items = menuItems.filter((item) => item.category === category.name);
              if (!items.length) return null;
              return (
                <div key={category.id || category.name}>
                  <div className="section-header">
                    <div className="section-header-inner">
                      <span className="section-header-title">
                        {getCatEmoji(category.name)} {category.name}
                      </span>
                      <span className="section-header-count">{items.length} items</span>
                    </div>
                  </div>
                  <div className="menu-grid">{items.map(renderCard)}</div>
                </div>
              );
            })
          ) : (
            <div className="menu-grid menu-grid-top">{filteredItems.map(renderCard)}</div>
          )}

          {!viewOnly && outsideMode && <FloatingCart cart={cart} />}
        </>
      )}
    </div>
  );
}
