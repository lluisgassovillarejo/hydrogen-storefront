import {
  useNonce,
  getShopAnalytics,
  Analytics,
  getSeoMeta,
  Script,
} from '@shopify/hydrogen';
import {
  defer,
  type MetaFunction,
  type LoaderFunctionArgs,
} from '@shopify/remix-oxygen';

import {
  Links,
  Meta,
  Outlet,
  Scripts,
  useRouteError,
  useRouteLoaderData,
  ScrollRestoration,
  isRouteErrorResponse,
  type ShouldRevalidateFunction,
} from '@remix-run/react';
import favicon from '~/assets/favicon.svg';
import resetStyles from '~/styles/reset.css?url';
import appStyles from '~/styles/app.css?url';
import tailwindCss from './styles/tailwind.css?url';
import {PageLayout} from '~/components/PageLayout';
import {FOOTER_QUERY, HEADER_QUERY} from '~/lib/fragments';

export type RootLoader = typeof loader;

const cleanParams = (url: URL) => {
  const whitelistedParams = ['color'];
  const params = Array.from(url.searchParams).filter(([key]) =>
    whitelistedParams.includes(key),
  );
  return new URLSearchParams(params).toString();
};

const cleanLocaleFromPathname = (url: URL) => {
  const localeMatch = /^\/([a-z]{2})-([a-z]{2})(\/|$)/i.exec(url.pathname);
  return localeMatch ? url.pathname.replace(localeMatch[0], '/') : url.pathname;
};

const createHreflangs = (url: URL) => {
  const paramString = cleanParams(url);
  const pathname = cleanLocaleFromPathname(url);
  return [
    {
      language: `en-us`,
      url: `${url.origin}${pathname}${paramString ? `?${paramString}` : ''}`,
      default: true,
    },
  ];
};

const createCanonicalUrl = (url: URL) => {
  const paramString = cleanParams(url);
  const pathname = cleanLocaleFromPathname(url);
  return paramString
    ? `${url.origin}${pathname}?${paramString}`
    : `${url.origin}${pathname}`;
};

const rootSeo = ({url}: {url: Request['url']}) => {
  const urlObject = new URL(url);
  const noIndex =
    urlObject.host === 'dev.honeylove.com' ||
    urlObject.host === 'staging.honeylove.com';
  const canonicalUrl = createCanonicalUrl(urlObject);
  const hreflangs = createHreflangs(urlObject);
  return {
    title: `Honeylove® · Where function meets fashion`,
    description:
      'Honeylove makes stylish garments with built-in shaping power, applying technical and artistic products for customers of all shapes, sizes, and backgrounds.',
    titleTemplate: '%s',
    media: {
      type: 'image' as const,
      url: 'og_homepage_480x.png',
      height: 252,
      width: 480,
      altText: 'Models in a grid',
    },
    handle: '@gethoneylove',
    url: canonicalUrl,
    robots: {
      noFollow: noIndex,
    },
    alternates: hreflangs,
    jsonLd: {
      '@context': 'https://schema.org' as const,
      '@type': 'Organization' as const,
      '@id': 'https://www.honeylove.com/',
      name: 'Honeylove',
      logo: 'og_homepage_480x.png',
      sameAs: [
        'https://twitter.com/gethoneylove',
        'https://facebook.com/GetHoneylove',
        'https://www.instagram.com/honeylove/',
        'https://youtube.com/@gethoneylove',
        'https://tiktok.com/@honeylove',
      ],
      url: canonicalUrl,
    },
  };
};

/**
 * This is important to avoid re-fetching root queries on sub-navigations
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({
  formMethod,
  currentUrl,
  nextUrl,
}) => {
  // revalidate when a mutation is performed e.g add to cart, login...
  if (formMethod && formMethod !== 'GET') {
    return true;
  }

  // revalidate when manually revalidating via useRevalidator
  if (currentUrl.toString() === nextUrl.toString()) {
    return true;
  }

  return false;
};

export function links() {
  return [
    {rel: 'stylesheet', href: tailwindCss},
    {rel: 'stylesheet', href: resetStyles},
    {rel: 'stylesheet', href: appStyles},
    {
      rel: 'preconnect',
      href: 'https://cdn.shopify.com',
    },
    {
      rel: 'preconnect',
      href: 'https://shop.app',
    },
    {rel: 'icon', type: 'image/svg+xml', href: favicon},
  ];
}

export async function loader(args: LoaderFunctionArgs) {
  const {request, context: rawContext} = args;

  // Start fetching non-critical data without blocking time to first byte
  const deferredData = loadDeferredData(args);

  // Await the critical data required to render initial state of the page
  const criticalData = await loadCriticalData(args);

  // Add the seo object
  const seo = rootSeo({url: request.url});

  const {storefront, env} = args.context;

  return defer({
    ...deferredData,
    ...criticalData,
    seo,
    publicStoreDomain: env.PUBLIC_STORE_DOMAIN,
    shop: getShopAnalytics({
      storefront,
      publicStorefrontId: env.PUBLIC_STOREFRONT_ID,
    }),
    consent: {
      checkoutDomain: env.PUBLIC_CHECKOUT_DOMAIN,
      storefrontAccessToken: env.PUBLIC_STOREFRONT_API_TOKEN,
    },
  });
}

/**
 * Load data necessary for rendering content above the fold. This is the critical data
 * needed to render the page. If it's unavailable, the whole page should 400 or 500 error.
 */
async function loadCriticalData({context}: LoaderFunctionArgs) {
  const {storefront} = context;

  const [header] = await Promise.all([
    storefront.query(HEADER_QUERY, {
      cache: storefront.CacheLong(),
      variables: {
        headerMenuHandle: 'main-menu', // Adjust to your header menu handle
      },
    }),
    // Add other queries here, so that they are loaded in parallel
  ]);

  return {
    header,
  };
}

/**
 * Load data for rendering content below the fold. This data is deferred and will be
 * fetched after the initial page load. If it's unavailable, the page should still 200.
 * Make sure to not throw any errors here, as it will cause the page to 500.
 */
function loadDeferredData({context}: LoaderFunctionArgs) {
  const {storefront, customerAccount, cart} = context;

  // defer the footer query (below the fold)
  const footer = storefront
    .query(FOOTER_QUERY, {
      cache: storefront.CacheLong(),
      variables: {
        footerMenuHandle: 'footer', // Adjust to your footer menu handle
      },
    })
    .catch((error) => {
      // Log query errors, but don't throw them so the page can still render
      console.error(error);
      return null;
    });
  return {
    cart: cart.get(),
    isLoggedIn: customerAccount.isLoggedIn(),
    footer,
  };
}

export function Layout({children}: {children?: React.ReactNode}) {
  const nonce = useNonce();
  const data = useRouteLoaderData<RootLoader>('root');

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
        <script></script>
        <Script
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','GTM-***');`,
          }}
          nonce={nonce}
        />
      </head>
      <body>
        {data ? (
          <Analytics.Provider
            cart={data.cart}
            shop={data.shop}
            consent={data.consent}
          >
            <PageLayout {...data}>{children}</PageLayout>
          </Analytics.Provider>
        ) : (
          children
        )}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export const meta: MetaFunction<typeof loader> = ({data}) => {
  return getSeoMeta(data?.seo) || [];
};

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  let errorMessage = 'Unknown error';
  let errorStatus = 500;

  if (isRouteErrorResponse(error)) {
    errorMessage = error?.data?.message ?? error.data;
    errorStatus = error.status;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }

  return (
    <div className="route-error">
      <h1>Oops</h1>
      <h2>{errorStatus}</h2>
      {errorMessage && (
        <fieldset>
          <pre>{errorMessage}</pre>
        </fieldset>
      )}
    </div>
  );
}
