export const fetchWrapper = async (input = "", init = {}) => {
    const response = await fetch(input, {
        headers: {
            authorization: sessionStorage.getItem("accessToken"),
            "Content-Type": "application/json"
        },
        ...init
    })
    const data = await response.json()
    if (response.status !== 200) {
        throw new Error(data)
    }
    return data
}

class Header extends HTMLElement {
    constructor() {
        super()
        this.innerHTML = `<div>
            <button id="go-to-cart">Cart</button>
            <button id="show-log-in">Log in</button>
            <button id="show-register">Register</button>
            <div id="register-modal" class="auth-modal" style="display: none;">
              <form action="http://localhost:8000/register" class="auth-form" method="POST" id="form-register">
                <span id="close-register" class="close">x</span>
                <div>Register</div>
                <label for="email">Email</label>
                <input type="text" name="email" required />
                <label for="password">Password</label>
                <input type="password" name="password" required />
                <button type="submit">Register</button>
              </form>
            </div>
            <div id="log-in-modal" class="auth-modal" style="display: none;">
              <form action="http://localhost:8000/log-in"class="auth-form" method="POST" id="form-log-in">
                <span id="close-log-in" class="close">x</span>
                <div>Log in</div>
                <label for="email">Email</label>
                <input type="text" name="email" required />
                <label for="password">Password</label>
                <input type="password" name="password" required />
                <button type="submit">Log In</button>
              </form>
            </div>
        <div>`
    }

    connectedCallback() {
      const goToCart = document.getElementById("go-to-cart")
      if (goToCart) {
          goToCart.onclick = () => {
              window.location.href = "/cart"
          }
      }
      const logInSubmit = async (e) => {
        const form = document.getElementById("form-log-in")
        e.preventDefault();
        try {
          const response = await fetch("http://localhost:8000/log-in", {
            method: 'POST',
            body: JSON.stringify({ email: form.email.value, password: form.password.value}),
            headers: {
              "Content-Type": "application/json"
            }
          })
          if (response.headers.accessToken) {
            sessionStorage("accessToken", response.headers.accessToken)
          }
          const data = await response.json();
          if (response.status !== 200) {
            throw new Error(data)
          }
          if (data._id && data.cart_id) {
            sessionStorage.setItem("user_id", data._id)
            sessionStorage.setItem("cart_id", data.cart_id)
          }
        } catch(e) {
          if (e instanceof Error) {
            alert(e.message)
          } else {
            alert("Error")
          }
        }
      }
      const formLogIn = document.getElementById("form-log-in")
      if (formLogIn) {
        formLogIn.addEventListener("submit", logInSubmit)
      }
      const registerSubmit = async (e) => {
        const form = document.getElementById("form-register")
        e.preventDefault();
        try {
          const response = await fetch("http://localhost:8000/register", {
            method: 'POST',
            body: JSON.stringify({ email: form.email.value, password: form.password.value}),
            headers: {
              "Content-Type": "application/json"
            }
          })
          if (response.headers.accessToken) {
            sessionStorage("accessToken", response.headers.accessToken)
          }
          const data = await response.json();
          if (response.status !== 200) {
            throw new Error(data)
          }
          if (data._id && data.cart_id) {
            sessionStorage.setItem("user_id", data._id)
            sessionStorage.setItem("cart_id", data.cart_id)
          }
        } catch(e) {
          if (e instanceof Error) {
            alert(e.message)
          } else {
            alert("Error")
          }
        }
      }
      const formRegister = document.getElementById("form-register")
      if (formRegister) {
        formRegister.addEventListener("submit", registerSubmit)
      }
      const logInModal = document.getElementById("log-in-modal");
      const showLogIn = document.getElementById("show-log-in");
      const closeLogIn = document.getElementById("close-log-in");
      showLogIn.onclick = () => {
        logInModal.style.display = "flex";
      }
      closeLogIn.onclick = () => {
        logInModal.style.display = "none";
      }
      window.onclick = (event) => {
        if (event.target == logInModal) {
          logInModal.style.display = "none";
        }
        if (event.target == registerModal) {
          registerModal.style.display = "none";
        }
      }
      const registerModal = document.getElementById("register-modal");
      const showRegister = document.getElementById("show-register");
      const closeRegister = document.getElementById("close-register");
      showRegister.onclick = () => {
        registerModal.style.display = "flex";
      }
      closeRegister.onclick = () => {
        registerModal.style.display = "none";
      }
    }
}

window.customElements.define('fourb-header', Header);
