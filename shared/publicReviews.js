import {
  collection,
  onSnapshot,
  query
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { db } from "./firebase.js";

const PUBLIC_REVIEWS_COLLECTION = "publicReviews";

const PLATFORM_META = {
  PlayStation: {
    label: "PlayStation",
    icon: "fa-brands fa-playstation"
  },
  Xbox: {
    label: "Xbox",
    icon: "fa-brands fa-xbox"
  },
  PC: {
    label: "PC",
    icon: "fa-solid fa-desktop"
  }
};

function cleanText(value) {
  return String(value ?? "").trim();
}

function formatQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return "—";
  }

  if (quantity >= 1000000) {
    return `${quantity.toLocaleString("en-US")} Coins`;
  }

  if (quantity >= 1000 && quantity % 1000 === 0) {
    return `${quantity / 1000}K Coins`;
  }

  return `${quantity.toLocaleString("en-US")} Coins`;
}

function renderStars(container, rating) {
  const safeRating = Math.max(1, Math.min(5, Number(rating) || 5));
  container.textContent = "";
  for (let index = 1; index <= 5; index += 1) {
    const star = document.createElement("span");
    star.className = index <= safeRating
      ? "public-review-star is-filled"
      : "public-review-star";
    star.textContent = "★";
    container.appendChild(star);
  }
}

function buildReviewCard(review) {
  const card = document.createElement("article");
  card.className = "public-review-card";

  const header = document.createElement("div");
  header.className = "public-review-card-header";

  const platform = document.createElement("div");
  platform.className = "public-review-platform";

  const meta = PLATFORM_META[cleanText(review.platform)] || {
    label: cleanText(review.platform) || "المنصة",
    icon: "fa-solid fa-gamepad"
  };

  const logo = document.createElement("span");
  logo.className = "public-review-platform-logo";
  const icon = document.createElement("i");
  icon.className = meta.icon;
  logo.appendChild(icon);

  const quantity = document.createElement("div");
  quantity.className = "public-review-quantity";
  quantity.textContent = formatQuantity(review.quantity);

  platform.append(logo, quantity);

  const stars = document.createElement("div");
  stars.className = "public-review-stars";
  renderStars(stars, review.rating);

  header.append(platform, stars);

  const comment = document.createElement("p");
  comment.className = "public-review-comment";
  comment.textContent = cleanText(review.comment) || "تجربة ممتازة معنا.";

  card.append(header, comment);
  return card;
}

function renderPublicReviews(container, reviews) {
  container.innerHTML = "";

  if (!reviews.length) {
    container.classList.add("is-empty");
    const empty = document.createElement("div");
    empty.className = "public-reviews-empty";
    empty.textContent = "كن أول من يشاركنا تجربته.";
    container.appendChild(empty);
    return;
  }

  container.classList.remove("is-empty");

  const track = document.createElement("div");
  track.className = "public-reviews-track";

  reviews.forEach((review) => {
    track.appendChild(buildReviewCard(review));
  });

  container.appendChild(track);
}

function initPublicReviews() {
  const containers = Array.from(
    document.querySelectorAll("[data-public-reviews]")
  );

  if (!containers.length) {
    return;
  }

  const reviewsQuery = query(
    collection(db, PUBLIC_REVIEWS_COLLECTION)
  );

  return onSnapshot(
    reviewsQuery,
    (snapshot) => {
      const reviews = snapshot.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data()
        }))
        .filter((review) => {
          return cleanText(review.platform) &&
            cleanText(review.comment) &&
            Number(review.quantity) > 0;
        })
        .sort((a, b) => {
          const aTime = a.publishedAt?.toMillis
            ? a.publishedAt.toMillis()
            : 0;
          const bTime = b.publishedAt?.toMillis
            ? b.publishedAt.toMillis()
            : 0;
          return bTime - aTime;
        });

      containers.forEach((container) => {
        renderPublicReviews(container, reviews);
      });
    },
    (error) => {
      console.error("Public reviews listener error:", error?.message || error);

      containers.forEach((container) => {
        renderPublicReviews(container, []);
      });
    }
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPublicReviews, { once: true });
} else {
  initPublicReviews();
}

export { initPublicReviews };
