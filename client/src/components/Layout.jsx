import PropTypes from 'prop-types';

const Layout = ({ header, sidebar, children, footer }) => (
  <div className="app-shell">
    {header && <header className="app-header">{header}</header>}
    <div className="app-body">
      {sidebar && <aside className="app-sidebar">{sidebar}</aside>}
      <main className="app-main">{children}</main>
    </div>
    {footer && <footer className="app-footer">{footer}</footer>}
  </div>
);

Layout.propTypes = {
  header: PropTypes.node,
  sidebar: PropTypes.node,
  children: PropTypes.node,
  footer: PropTypes.node,
};

Layout.defaultProps = {
  header: null,
  sidebar: null,
  children: null,
  footer: null,
};

export default Layout;
