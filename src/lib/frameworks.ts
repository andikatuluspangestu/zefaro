// Names and icons for the frameworks the backend detects (engine/framework.rs).

export interface FrameworkInfo {
  name: string;
  /** Font Awesome icon name. */
  icon: string;
  brand: boolean;
}

const FRAMEWORKS: Record<string, FrameworkInfo> = {
  laravel: { name: "Laravel", icon: "laravel", brand: true },
  statamic: { name: "Statamic", icon: "laravel", brand: true },
  lumen: { name: "Lumen", icon: "laravel", brand: true },
  symfony: { name: "Symfony", icon: "symfony", brand: true },
  wordpress: { name: "WordPress", icon: "wordpress", brand: true },
  drupal: { name: "Drupal", icon: "drupal", brand: true },
  joomla: { name: "Joomla", icon: "joomla", brand: true },
  magento: { name: "Magento", icon: "magento", brand: true },
  craft: { name: "Craft CMS", icon: "feather-pointed", brand: false },
  contao: { name: "Contao", icon: "cube", brand: false },
  codeigniter: { name: "CodeIgniter", icon: "fire-flame-curved", brand: false },
  cakephp: { name: "CakePHP", icon: "cake-candles", brand: false },
  yii: { name: "Yii", icon: "cube", brand: false },
  laminas: { name: "Laminas", icon: "cube", brand: false },
  slim: { name: "Slim", icon: "cube", brand: false },
  php: { name: "PHP", icon: "php", brand: true },
  static: { name: "HTML", icon: "html5", brand: true },
};

export const frameworkInfo = (id: string | undefined): FrameworkInfo | null => (id ? (FRAMEWORKS[id] ?? null) : null);
